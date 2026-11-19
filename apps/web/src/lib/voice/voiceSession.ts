'use client';

import {
  isOfferer,
  type AckResult,
  type IceServer,
  type ServerToClientEvents,
  type VoiceJoinAck,
  type VoicePeer,
  type VoiceSignalData,
} from '@rotationlab/shared';
import { getSocket } from '@/lib/realtime/socket';
import type { RtSocket } from '@/lib/realtime/connection';
import { resetVoice, setLink, setSpeaking, useVoiceStore } from '@/stores/voiceStore';
import {
  joinErrorText,
  micProblemOf,
  rmsLevel,
  SPEAKING_HANGOVER_MS,
  SPEAKING_RMS,
} from './voiceModel';

const ACK_TIMEOUT_MS = 10_000;
/** a link stuck in "disconnected" this long gets an ICE restart (from the offerer) */
const RESTART_AFTER_MS = 5_000;
const LEVEL_POLL_MS = 100;

interface Peer {
  peerId: string;
  userId: string;
  pc: RTCPeerConnection;
  offerer: boolean;
  audio: HTMLAudioElement | null;
  analyser: AnalyserNode | null;
  /** candidates that arrived before the remote description */
  pending: RTCIceCandidateInit[];
  restartTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Room voice chat (FEATURES F19, ARCHITECTURE §7.8): a WebRTC mesh — one RTCPeerConnection per
 * other participant, audio only, signalled over the room socket. Of each pair the smaller peer
 * id offers (no glare) and restarts ICE when the link fails. Everyone joins muted; mute only
 * disables the mic track (no renegotiation). With no usable mic the user joins listen-only.
 * After a reconnect (new socket = new peer id) it rejoins by itself.
 */
export class VoiceSession {
  /** looked up on use: the object may be created during a server render */
  private get socket(): RtSocket {
    return getSocket();
  }
  private offs: (() => void)[] = [];
  private peers = new Map<string, Peer>();
  private iceServers: IceServer[] = [];
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private lastLoud = new Map<string, number>();
  /** the user wants to be in voice (survives reconnects) */
  private wanted = false;
  private pttHeld = false;
  /** the mute flag the server last acknowledged (null: unknown — send it) */
  private sentMuted: boolean | null = null;
  private joinSeq = 0;
  /** signals that beat our own join ack (we don't know our peer id yet) */
  private early: [string, VoiceSignalData][] = [];

  constructor(
    readonly roomId: string,
    private readonly meId: string,
    private readonly notify: (message: string) => void,
  ) {}

  start() {
    resetVoice(this.roomId);
    this.on('voice:peers', ({ roomId, peers }) => {
      if (roomId === this.roomId) this.roster(peers);
    });
    this.on('voice:signal', ({ roomId, from, data }) => {
      if (roomId === this.roomId) void this.signal(from, data);
    });
    this.on('voice:ended', ({ roomId }) => {
      if (roomId !== this.roomId) return;
      this.teardown();
      this.notify('Voice moved to your other tab');
    });
    this.on('connect', () => {
      // a new socket: old links are dead, and our peer id changed
      if (!this.wanted) return;
      this.closePeers();
      void this.rejoin();
    });
  }

  stop() {
    if (this.wanted) void this.leave();
    for (const off of this.offs.splice(0)) off();
    this.teardown();
    resetVoice(null);
  }

  // ---- join / leave ------------------------------------------------------------------------

  async join() {
    if (this.wanted) return;
    this.wanted = true;
    useVoiceStore.setState({ status: 'joining', mic: null });
    // the click that got us here unlocks audio playback and the AudioContext
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.track = this.stream.getAudioTracks()[0] ?? null;
    } catch (err) {
      useVoiceStore.setState({ mic: micProblemOf(err) });
    }
    // left (or got taken out) while the permission prompt was open
    if (!this.isWanted()) {
      this.releaseMic();
      return;
    }
    if (this.track) {
      this.track.enabled = false; // everyone joins muted
      this.localAnalyser = this.analyse(new MediaStream([this.track]));
    }
    this.startLevels();
    await this.rejoin();
  }

  private async rejoin() {
    const seq = (this.joinSeq += 1);
    const res = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('voice:join', { roomId: this.roomId })
      .catch(() => null)) as AckResult<VoiceJoinAck> | null;
    if (seq !== this.joinSeq || !this.wanted) return;
    if (!res || !res.ok) {
      this.notify(joinErrorText(res ? res.code : 'TIMEOUT', res ? res.message : ''));
      this.teardown();
      return;
    }
    const { peerId, peers, iceServers } = res.data;
    this.iceServers = iceServers;
    useVoiceStore.setState({ status: 'joined', myPeerId: peerId });
    // a new socket starts muted on the server: resend the user's choice
    this.sentMuted = null;
    void this.sendMute();
    for (const p of peers) this.ensurePeer(p.peerId, p.userId);
    for (const [from, data] of this.early.splice(0)) void this.signal(from, data);
  }

  async leave() {
    this.wanted = false;
    this.joinSeq += 1;
    if (this.socket.connected)
      await this.socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('voice:leave', { roomId: this.roomId })
        .catch(() => null);
    this.teardown();
  }

  /** back to idle: links closed, mic released (the roster stays — it's the room's) */
  private teardown() {
    this.wanted = false;
    this.joinSeq += 1;
    this.closePeers();
    this.releaseMic();
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.pttHeld = false;
    this.early = [];
    this.sentMuted = null;
    useVoiceStore.setState({
      status: 'idle',
      myPeerId: null,
      muted: true,
      deafened: false,
      links: {},
      speaking: {},
    });
  }

  private releaseMic() {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.track = null;
    this.localAnalyser = null;
  }

  /** re-read after an await (the user may have left meanwhile) */
  private isWanted() {
    return this.wanted;
  }

  // ---- mic controls ------------------------------------------------------------------------

  setMuted(muted: boolean) {
    if (!this.track) return;
    if (!muted) this.setDeafened(false); // talking means listening too
    useVoiceStore.setState({ muted });
    this.applyMic();
  }

  setDeafened(deafened: boolean) {
    const s = useVoiceStore.getState();
    if (s.deafened === deafened) return;
    useVoiceStore.setState({ deafened, ...(deafened ? { muted: true } : {}) });
    for (const p of this.peers.values()) if (p.audio) p.audio.muted = deafened;
    this.applyMic();
  }

  setPushToTalk(on: boolean) {
    useVoiceStore.setState({ pushToTalk: on, muted: true });
    this.pttHeld = false;
    this.applyMic();
  }

  /** push-to-talk key / button held or released */
  holdToTalk(held: boolean) {
    if (!useVoiceStore.getState().pushToTalk || this.pttHeld === held) return;
    this.pttHeld = held;
    useVoiceStore.setState({ muted: !held });
    this.applyMic();
  }

  private applyMic() {
    const s = useVoiceStore.getState();
    const live = Boolean(this.track) && !s.deafened && (s.pushToTalk ? this.pttHeld : !s.muted);
    if (this.track) this.track.enabled = live;
    if (!live) setSpeaking(this.meId, false);
    void this.sendMute();
  }

  private async sendMute() {
    if (useVoiceStore.getState().status !== 'joined') return;
    const muted = !this.track?.enabled;
    if (muted === this.sentMuted) return;
    this.sentMuted = muted;
    const res = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('voice:mute', { roomId: this.roomId, muted })
      .catch(() => null)) as AckResult<undefined> | null;
    if (!res?.ok) this.sentMuted = null; // resent on the next change / rejoin
  }

  // ---- roster & peer connections -------------------------------------------------------------

  private roster(peers: VoicePeer[]) {
    useVoiceStore.setState({ peers });
    const me = useVoiceStore.getState().myPeerId;
    if (!me || !this.wanted) return;
    const present = new Set(peers.map((p) => p.peerId));
    for (const id of [...this.peers.keys()]) if (!present.has(id)) this.closePeer(id);
    for (const p of peers) if (p.peerId !== me) this.ensurePeer(p.peerId, p.userId);
  }

  /** a link to `peerId`; the offerer of the pair starts negotiating straight away */
  private ensurePeer(peerId: string, userId: string): Peer {
    const existing = this.peers.get(peerId);
    if (existing) {
      // an offer can arrive before the roster names its sender
      if (!existing.userId) existing.userId = userId;
      return existing;
    }
    const me = useVoiceStore.getState().myPeerId ?? '';
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    const peer: Peer = {
      peerId,
      userId,
      pc,
      offerer: isOfferer(me, peerId),
      audio: null,
      analyser: null,
      pending: [],
      restartTimer: null,
    };
    this.peers.set(peerId, peer);
    setLink(peerId, 'connecting');
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      if (c)
        this.send(peerId, {
          type: 'ice',
          candidate: {
            candidate: c.candidate,
            sdpMid: c.sdpMid,
            sdpMLineIndex: c.sdpMLineIndex,
            usernameFragment: c.usernameFragment,
          },
        });
    };
    pc.ontrack = (e) => {
      this.play(peer, e.streams[0] ?? new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      this.linkChanged(peer);
    };
    if (peer.offerer) {
      if (this.track && this.stream) pc.addTrack(this.track, this.stream);
      else pc.addTransceiver('audio', { direction: 'recvonly' });
      void this.offer(peer);
    }
    return peer;
  }

  private async offer(peer: Peer, iceRestart = false) {
    try {
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(offer);
      const sdp = peer.pc.localDescription?.sdp;
      if (sdp) this.send(peer.peerId, { type: 'offer', sdp });
    } catch {
      setLink(peer.peerId, 'failed');
    }
  }

  private async signal(from: string, data: VoiceSignalData) {
    if (!this.wanted) return;
    if (!useVoiceStore.getState().myPeerId) {
      if (this.early.length < 200) this.early.push([from, data]);
      return;
    }
    try {
      if (data.type === 'offer') {
        // the server only relays from sockets in this channel; the roster may lag behind
        const userId = useVoiceStore.getState().peers.find((p) => p.peerId === from)?.userId;
        const peer = this.peers.get(from) ?? this.ensurePeer(from, userId ?? '');
        const fresh = peer.pc.getTransceivers().every((t) => !t.currentDirection);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        if (fresh) {
          // answer on the transceiver the offer created: send our mic on it (or just listen)
          const t = peer.pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio');
          if (t) {
            if (this.track) await t.sender.replaceTrack(this.track);
            t.direction = this.track ? 'sendrecv' : 'recvonly';
          }
        }
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        const sdp = peer.pc.localDescription?.sdp;
        if (sdp) this.send(from, { type: 'answer', sdp });
        await this.flushCandidates(peer);
      } else if (data.type === 'answer') {
        const peer = this.peers.get(from);
        if (peer?.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushCandidates(peer);
      } else {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pending.push(data.candidate);
      }
    } catch {
      // a bad or stale description: the link shows as failed; an ICE restart may recover it
      setLink(from, 'failed');
    }
  }

  private async flushCandidates(peer: Peer) {
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
  }

  private linkChanged(peer: Peer) {
    const state = peer.pc.connectionState;
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.restartTimer = null;
    if (state === 'connected') setLink(peer.peerId, 'connected');
    else if (state === 'failed') {
      setLink(peer.peerId, 'failed');
      if (peer.offerer) this.restart(peer);
    } else if (state === 'disconnected') {
      // often recovers by itself (Wi-Fi blip); otherwise restart ICE
      setLink(peer.peerId, 'connecting');
      if (peer.offerer)
        peer.restartTimer = setTimeout(() => {
          this.restart(peer);
        }, RESTART_AFTER_MS);
    } else if (state === 'connecting' || state === 'new') setLink(peer.peerId, 'connecting');
  }

  private restart(peer: Peer) {
    if (!this.peers.has(peer.peerId)) return;
    peer.pc.restartIce();
    void this.offer(peer, true);
  }

  private send(to: string, data: VoiceSignalData) {
    this.socket.emit('voice:signal', { roomId: this.roomId, to, data });
  }

  private closePeer(peerId: string) {
    const p = this.peers.get(peerId);
    if (!p) return;
    this.peers.delete(peerId);
    if (p.restartTimer) clearTimeout(p.restartTimer);
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    if (p.audio) {
      p.audio.srcObject = null;
      p.audio.remove();
    }
    setLink(peerId, null);
    if (p.userId) setSpeaking(p.userId, false);
  }

  private closePeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  // ---- audio out & speaking detection ---------------------------------------------------------

  private play(peer: Peer, stream: MediaStream) {
    if (!peer.audio) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.voicePeer = peer.peerId;
      el.hidden = true;
      document.body.appendChild(el);
      peer.audio = el;
    }
    peer.audio.srcObject = stream;
    peer.audio.muted = useVoiceStore.getState().deafened;
    void peer.audio.play().catch(() => undefined);
    peer.analyser = this.analyse(stream);
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.ctx) return null;
    try {
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    } catch {
      return null;
    }
  }

  private startLevels() {
    if (this.levelTimer) return;
    const frame = new Uint8Array(512);
    this.levelTimer = setInterval(() => {
      const now = Date.now();
      const check = (userId: string, analyser: AnalyserNode | null, live: boolean) => {
        if (!userId) return;
        let loud = false;
        if (analyser && live) {
          analyser.getByteTimeDomainData(frame);
          loud = rmsLevel(frame) > SPEAKING_RMS;
        }
        if (loud) this.lastLoud.set(userId, now);
        setSpeaking(userId, now - (this.lastLoud.get(userId) ?? 0) < SPEAKING_HANGOVER_MS);
      };
      check(this.meId, this.localAnalyser, Boolean(this.track?.enabled));
      const muted = new Set(
        useVoiceStore
          .getState()
          .peers.filter((p) => p.muted)
          .map((p) => p.peerId),
      );
      for (const p of this.peers.values()) check(p.userId, p.analyser, !muted.has(p.peerId));
    }, LEVEL_POLL_MS);
  }

  // ---- events -----------------------------------------------------------------------------

  private on<E extends keyof ServerToClientEvents | 'connect'>(
    event: E,
    fn: E extends keyof ServerToClientEvents ? ServerToClientEvents[E] : () => void,
  ) {
    (this.socket.on as (e: string, f: unknown) => void)(event, fn);
    this.offs.push(() => {
      (this.socket.off as (e: string, f: unknown) => void)(event, fn);
    });
  }
}

/**
 * Loot markers (Phase 12): the PUBG item icons a `loot` marker can show. Sources are files of
 * pubg/api-assets (`Assets/Icons/Item/**`, `Assets/Icons/CarePackage/*`, commit 32b13b5 — the
 * map art's commit); `packages/map-tiles` fetches them and writes `icons/items/<id>.webp` next
 * to the tiles. Names are the in-game ones where PUBG's file name is internal (HK416 → M416).
 * The id list is the allow-list for `props.item` — a marker never carries a path or URL.
 * TODO(phase0): covered by the same PUBG asset licensing review as the map art.
 */
export const LOOT_CATEGORIES = [
  'care',
  'weapon',
  'handgun',
  'throwable',
  'equipment',
  'melee',
] as const;
export type LootCategory = (typeof LOOT_CATEGORIES)[number];

export const LOOT_CATEGORY_NAMES: Record<LootCategory, string> = {
  care: 'Care packages',
  weapon: 'Weapons',
  handgun: 'Handguns',
  throwable: 'Throwables',
  equipment: 'Equipment',
  melee: 'Melee',
};

export interface LootItem {
  id: string;
  name: string;
  category: LootCategory;
  /** path in pubg/api-assets */
  source: string;
}

export const LOOT_ITEMS: readonly LootItem[] = [
  {
    id: 'care_package',
    name: 'Care Package',
    category: 'care',
    source: 'Assets/Icons/CarePackage/CarePackage_Normal.png',
  },
  {
    id: 'care_package_falling',
    name: 'Care Package (falling)',
    category: 'care',
    source: 'Assets/Icons/CarePackage/CarePackage_Flying.png',
  },
  {
    id: 'care_package_open',
    name: 'Care Package (open)',
    category: 'care',
    source: 'Assets/Icons/CarePackage/CarePackage_Open.png',
  },
  {
    id: 'ace32',
    name: 'ACE32',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_ACE32_C.png',
  },
  {
    id: 'akm',
    name: 'AKM',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_AK47_C.png',
  },
  {
    id: 'aug',
    name: 'AUG',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_AUG_C.png',
  },
  {
    id: 'awm',
    name: 'AWM',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_AWM_C.png',
  },
  {
    id: 'beryl_m762',
    name: 'Beryl M762',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_BerylM762_C.png',
  },
  {
    id: 'crossbow',
    name: 'Crossbow',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Crossbow_C.png',
  },
  {
    id: 'dbs',
    name: 'DBS',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_DP12_C.png',
  },
  {
    id: 'dp_28',
    name: 'DP-28',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_DP28_C.png',
  },
  {
    id: 'dragunov',
    name: 'Dragunov',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Dragunov_C.png',
  },
  {
    id: 'famas',
    name: 'FAMAS',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_FAMASG2_C.png',
  },
  {
    id: 'g36c',
    name: 'G36C',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_G36C_C.png',
  },
  {
    id: 'groza',
    name: 'Groza',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Groza_C.png',
  },
  {
    id: 'k2',
    name: 'K2',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_K2_C.png',
  },
  {
    id: 'kar98k',
    name: 'Kar98k',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Kar98k_C.png',
  },
  {
    id: 'lynx_amr',
    name: 'Lynx AMR',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_L6_C.png',
  },
  {
    id: 'm16a4',
    name: 'M16A4',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_M16A4_C.png',
  },
  {
    id: 'm24',
    name: 'M24',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_M24_C.png',
  },
  {
    id: 'm249',
    name: 'M249',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_M249_C.png',
  },
  {
    id: 'm416',
    name: 'M416',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_HK416_C.png',
  },
  {
    id: 'mg3',
    name: 'MG3',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_MG3_C.png',
  },
  {
    id: 'micro_uzi',
    name: 'Micro UZI',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_UZI_C.png',
  },
  {
    id: 'mini14',
    name: 'Mini14',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Mini14_C.png',
  },
  {
    id: 'mk12',
    name: 'Mk12',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Mk12_C.png',
  },
  {
    id: 'mk14',
    name: 'Mk14',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Mk14_C.png',
  },
  {
    id: 'mk47_mutant',
    name: 'Mk47 Mutant',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Mk47Mutant_C.png',
  },
  {
    id: 'mosin_nagant',
    name: 'Mosin-Nagant',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Mosin_C.png',
  },
  {
    id: 'mp5k',
    name: 'MP5K',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_MP5K_C.png',
  },
  {
    id: 'mp9',
    name: 'MP9',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_MP9_C.png',
  },
  {
    id: 'o12',
    name: 'O12',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_OriginS12_C.png',
  },
  {
    id: 'p90',
    name: 'P90',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_P90_C.png',
  },
  {
    id: 'panzerfaust',
    name: 'Panzerfaust',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_PanzerFaust100M_C.png',
  },
  {
    id: 'pp_19_bizon',
    name: 'PP-19 Bizon',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_BizonPP19_C.png',
  },
  {
    id: 'qbu',
    name: 'QBU',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_QBU88_C.png',
  },
  {
    id: 'qbz',
    name: 'QBZ',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_QBZ95_C.png',
  },
  {
    id: 's12k',
    name: 'S12K',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Saiga12_C.png',
  },
  {
    id: 's1897',
    name: 'S1897',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Winchester_C.png',
  },
  {
    id: 's686',
    name: 'S686',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Berreta686_C.png',
  },
  {
    id: 'scar_l',
    name: 'SCAR-L',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_SCAR-L_C.png',
  },
  {
    id: 'sks',
    name: 'SKS',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_SKS_C.png',
  },
  {
    id: 'slr',
    name: 'SLR',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_FNFal_C.png',
  },
  {
    id: 'tommy_gun',
    name: 'Tommy Gun',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Thompson_C.png',
  },
  {
    id: 'ump45',
    name: 'UMP45',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_UMP_C.png',
  },
  {
    id: 'vector',
    name: 'Vector',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Vector_C.png',
  },
  {
    id: 'vss',
    name: 'VSS',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_VSS_C.png',
  },
  {
    id: 'win94',
    name: 'Win94',
    category: 'weapon',
    source: 'Assets/Icons/Item/Weapon/Main/Item_Weapon_Win1894_C.png',
  },
  {
    id: 'deagle',
    name: 'Deagle',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_DesertEagle_C.png',
  },
  {
    id: 'flare_gun',
    name: 'Flare Gun',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_FlareGun_C.png',
  },
  {
    id: 'p18c',
    name: 'P18C',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_G18_C.png',
  },
  {
    id: 'p1911',
    name: 'P1911',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_M1911_C.png',
  },
  {
    id: 'p92',
    name: 'P92',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_M9_C.png',
  },
  {
    id: 'r1895',
    name: 'R1895',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_NagantM1895_C.png',
  },
  {
    id: 'r45',
    name: 'R45',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_Rhino_C.png',
  },
  {
    id: 'sawed_off',
    name: 'Sawed-off',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_Sawnoff_C.png',
  },
  {
    id: 'skorpion',
    name: 'Skorpion',
    category: 'handgun',
    source: 'Assets/Icons/Item/Weapon/Handgun/Item_Weapon_vz61Skorpion_C.png',
  },
  {
    id: 'bluezone_grenade',
    name: 'Bluezone Grenade',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_BluezoneGrenade_C.png',
  },
  {
    id: 'c4',
    name: 'C4',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_C4_C.png',
  },
  {
    id: 'decoy_grenade',
    name: 'Decoy Grenade',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_DecoyGrenade_C.png',
  },
  {
    id: 'frag_grenade',
    name: 'Frag Grenade',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_Grenade_C.png',
  },
  {
    id: 'molotov_cocktail',
    name: 'Molotov Cocktail',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_Molotov_C.png',
  },
  {
    id: 'smoke_grenade',
    name: 'Smoke Grenade',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_SmokeBomb_C.png',
  },
  {
    id: 'spike_trap',
    name: 'Spike Trap',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_SpikeTrap_C.png',
  },
  {
    id: 'sticky_bomb',
    name: 'Sticky Bomb',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_StickyGrenade_C.png',
  },
  {
    id: 'stun_grenade',
    name: 'Stun Grenade',
    category: 'throwable',
    source: 'Assets/Icons/Item/Equipment/Throwable/Item_Weapon_FlashBang_c.png',
  },
  {
    id: 'backpack_blue_blocker',
    name: 'Backpack (Blue Blocker)',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Backpack/Item_Back_BlueBlocker.png',
  },
  {
    id: 'backpack_lv_1',
    name: 'Backpack Lv.1',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Backpack/Item_Back_E_00_Lv1_C.png',
  },
  {
    id: 'backpack_lv_2',
    name: 'Backpack Lv.2',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Backpack/Item_Back_F_00_Lv2_C.png',
  },
  {
    id: 'backpack_lv_3',
    name: 'Backpack Lv.3',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Backpack/Item_Back_C_00_Lv3_C.png',
  },
  {
    id: 'helmet_lv_1',
    name: 'Helmet Lv.1',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Headgear/Item_Head_E_00_Lv1_C.png',
  },
  {
    id: 'helmet_lv_2',
    name: 'Helmet Lv.2',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Headgear/Item_Head_F_00_Lv2_C.png',
  },
  {
    id: 'helmet_lv_3',
    name: 'Helmet Lv.3',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Headgear/Item_Head_G_00_Lv3_C.png',
  },
  {
    id: 'vest_lv_1',
    name: 'Vest Lv.1',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Vest/Item_Armor_E_00_Lv1_C.png',
  },
  {
    id: 'vest_lv_2',
    name: 'Vest Lv.2',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Vest/Item_Armor_D_00_Lv2_C.png',
  },
  {
    id: 'vest_lv_3',
    name: 'Vest Lv.3',
    category: 'equipment',
    source: 'Assets/Icons/Item/Equipment/Vest/Item_Armor_C_00_Lv3_C.png',
  },
  {
    id: 'crowbar',
    name: 'Crowbar',
    category: 'melee',
    source: 'Assets/Icons/Item/Weapon/Melee/Item_Weapon_Cowbar_C.png',
  },
  {
    id: 'machete',
    name: 'Machete',
    category: 'melee',
    source: 'Assets/Icons/Item/Weapon/Melee/Item_Weapon_Machete_C.png',
  },
  {
    id: 'pan',
    name: 'Pan',
    category: 'melee',
    source: 'Assets/Icons/Item/Weapon/Melee/Item_Weapon_Pan_C.png',
  },
  {
    id: 'sickle',
    name: 'Sickle',
    category: 'melee',
    source: 'Assets/Icons/Item/Weapon/Melee/Item_Weapon_Sickle_C.png',
  },
];

const BY_ID = new Map(LOOT_ITEMS.map((i) => [i.id, i]));

export function lootItem(id: unknown): LootItem | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

/** Icon path relative to the tiles base URL (NEXT_PUBLIC_TILES_BASE_URL). */
export function lootIconPath(id: string): string {
  return `icons/items/${id}.webp`;
}

/** The marker tool's default pick. */
export const DEFAULT_LOOT_ITEM = 'care_package';

import { makeConfig } from './playwright.config';

/** `pnpm test:e2e:dev`: reuse the running `pnpm dev` servers (:3000 / :4000). */
export default makeConfig('dev');

import '@testing-library/jest-dom/vitest';
import {beforeEach} from 'vitest';
import {socialCache} from '../lib/socialCache.js';
// What the Social screens remember between visits must never leak from one test into the next.
beforeEach(()=>socialCache.clear());

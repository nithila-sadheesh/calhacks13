// `.js`, not `.ts`: Vercel compiles this function to JavaScript and keeps the import path as
// written, so a `.ts` path fails at runtime. TypeScript and Vite map `.js` back to the source.
export { POST } from '../server/assistant.js';

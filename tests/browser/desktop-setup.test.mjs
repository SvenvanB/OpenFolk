// The desktop app's setup page (desktop/setup.html, setup.js): the three ways explained, a question before this
// computer is left without a backend of its own, and every text of the page in both languages of desktop/main.js.
// The page runs without Electron here; a stand-in for the bridge of preload.js records what the page asks for.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = pathToFileURL(path.join(ROOT, 'desktop', 'setup.html')).href;

/** The keys of the text blocks of desktop/main.js (TEXTS: en first, then de). */
function textKeys() {
    const lines = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').split('\n');
    const en = lines.findIndex((l) => l === '    en: {');
    const de = lines.findIndex((l) => l === '    de: {');
    const keys = (from, to) => new Set(lines.slice(from, to).flatMap((l) => { const m = /^\s{8}(\w+): /.exec(l); return m ? [m[1]] : []; }));
    return { en: keys(en, de), de: keys(de, lines.length), blocks: en >= 0 && de > en ? 2 : 0 };
}

export default async function ({ check }) {
    const html = fs.readFileSync(path.join(ROOT, 'desktop', 'setup.html'), 'utf8');
    const used = [...html.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]);
    const { en, de, blocks } = textKeys();
    check('setup page: every text exists in English and in German', blocks === 2 && used.every((k) => en.has(k) && de.has(k)),
        used.filter((k) => !en.has(k) || !de.has(k)));

    const browser = await chromium.launch();
    try {
        const open = async (mode, answer = {}) => {
            const context = await browser.newContext({ bypassCSP: true });
            await context.addInitScript(`
                window.__calls = [];
                window.openfolkDesktop = {
                    info: async () => ({ mode: ${JSON.stringify(mode)}, language: 'en', version: '0.0.0', texts: { setupHint: 'OpenFolk {version}', invalidAddress: 'Please enter a server URL.' } }),
                    saveAddress: async (url) => { window.__calls.push(url); return ${JSON.stringify(answer)}; },
                    chooseLocal: async () => ({}), joinServer: async () => ({}),
                };`);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(PAGE);
            await page.waitForFunction(() => document.getElementById('info').textContent !== '');
            return { page, context, errors, calls: () => page.evaluate(() => window.__calls) };
        };

        // First start: nothing chosen yet
        let s = await open('');
        const p = s.page;
        const shown = (sel) => p.isVisible(sel);
        check('setup page: says which way fits where bots should work', (await p.textContent('.where')).includes('B or C'));
        const badges = await p.$$eval('.option .badge', (n) => n.map((x) => x.textContent));
        check('setup page: the three ways are lettered A, B, C', badges.join() === 'A,B,C', badges);
        check('setup page: the server way warns that no backend runs here', await shown('#form') && (await p.textContent('.option .warn')).includes('no backend on this computer'));

        await p.click('#form button');
        check('setup page: an empty address is refused without asking', (await p.textContent('#error')) === 'Please enter a server URL.' && !(await shown('#relay-confirm')) && (await s.calls()).length === 0);

        await p.fill('#url', 'https://openfolk.example.test');
        await p.click('#form button');
        check('setup page: connecting asks first; nothing is saved yet', await shown('#relay-confirm') && (await s.calls()).length === 0);
        check('setup page: the question names the consequence, the button says it', (await p.textContent('#relay-confirm .warn')).includes('no bots run on this computer')
            && (await p.textContent('#relay-confirm-yes')) === 'Yes, no bots run on this computer');
        check('setup page: while asking, the address cannot change and "Connect" is out of the way', await p.isDisabled('#url') && !(await shown('#form button')));

        await p.click('#relay-confirm-no');
        check('setup page: "Back" returns to the form, nothing saved', !(await shown('#relay-confirm')) && await p.isEnabled('#url') && await shown('#form button') && (await s.calls()).length === 0);

        await p.click('#form button');
        await p.click('#relay-confirm-yes');
        check('setup page: after "Yes" the address is saved, once', JSON.stringify(await s.calls()) === '["https://openfolk.example.test"]', await s.calls());
        check('setup page: no script errors', s.errors.length === 0, s.errors);
        await s.context.close();

        // A refused address: back at the form with the reason
        s = await open('', { error: 'The server needs HTTPS.' });
        await s.page.fill('#url', 'http://x.test');
        await s.page.click('#form button');
        await s.page.click('#relay-confirm-yes');
        await s.page.waitForFunction(() => document.getElementById('error').textContent !== '');
        check('setup page: a refused address shows the reason in the form', (await s.page.textContent('#error')) === 'The server needs HTTPS.' && !(await s.page.isVisible('#relay-confirm')) && await s.page.isEnabled('#url'));
        await s.context.close();

        // Already connected to a server: changing the address changes nothing for the backend, so no question
        s = await open('relay');
        await s.page.fill('#url', 'https://other.example.test');
        await s.page.click('#form button');
        await s.page.waitForFunction(() => window.__calls.length > 0);
        check('setup page: from the server way to another address: saved at once', !(await s.page.isVisible('#relay-confirm')) && (await s.calls())[0] === 'https://other.example.test');
        await s.context.close();
    } finally {
        await browser.close();
    }
}

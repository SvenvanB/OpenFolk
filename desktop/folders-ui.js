// The list of folders bots may work in (ALLOWED_ROOTS), shared by the window "Allowed folders" (folders.html) and the
// setup page. Nothing is saved here: the page reads the list with `get()` and hands it to the main process.
// `texts` come from the main process (English or German).
'use strict';

/**
 * @param {HTMLElement} root where the list is built
 * @param {{ roots: string[], home: string, env: string, texts: Record<string, string> }} info
 *   roots: the folders in the profile's .env; home: the default when there is none; env: the value of a ALLOWED_ROOTS
 *   environment variable, which the backend prefers over the .env
 * @returns {{ get: () => string[], error: (text: string) => void }}
 */
window.mountFolders = function mountFolders(root, { roots, home, env, texts }) {
    const list = [...roots];
    const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
    const make = (tag, className, text) => {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    };

    root.textContent = '';
    if (env) root.append(make('p', 'warn', fill(texts.foldersEnvWarn, { value: env })));
    const ul = make('ul', 'folder-list');
    const fallback = make('p', 'folder-default', fill(texts.foldersDefault, { home }));
    const problem = make('p', 'error');
    const add = make('button', 'secondary folder-add', texts.foldersAdd);
    add.type = 'button';
    root.append(ul, fallback, add, problem);

    function render() {
        ul.textContent = '';
        for (const folder of list) {
            const li = make('li');
            const remove = make('button', 'secondary folder-remove', texts.foldersRemove);
            remove.type = 'button';
            remove.addEventListener('click', () => {
                list.splice(list.indexOf(folder), 1);
                problem.textContent = '';
                render();
            });
            li.append(make('span', 'folder-path', folder), remove);
            ul.append(li);
        }
        // Without a folder the backend falls back to the user folder
        fallback.hidden = list.length > 0;
    }

    add.addEventListener('click', async () => {
        problem.textContent = '';
        const folder = await window.openfolkDesktop.pickFolder();
        if (folder && !list.includes(folder)) list.push(folder);
        render();
    });

    render();
    return { get: () => [...list], error: (text) => { problem.textContent = text; } };
};

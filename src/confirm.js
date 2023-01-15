const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.send('load');

    ipcRenderer.on('skript', ( e, name ) =>
        document.querySelector('#name').innerHTML = name);

    document.querySelector('#confirm').onclick = () => ipcRenderer.send('confirm');
    document.querySelector('#cancel').onclick = () => ipcRenderer.send('cancel');
})
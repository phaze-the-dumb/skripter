const { app, Tray, Menu, nativeImage, shell, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const ws = require('ws');
const fs = require('fs');
const fetch = require('node-fetch');
const vm = require('vm');
const { randomUUID } = require('crypto');

let fullText = '';
let currentSong = '';
let sockets = [];
let events = [];
let tray;
let confirmWin;
let contextMenu;

let emit = ( event, ...args) => {
    events.forEach(e => {
        if(e.name === event)
            e.cb(...args);
    })

    sockets.forEach(s => {
        s.send(JSON.stringify({
            type: 'event',
            name: event,
            args: args
        }))
    })

    console.log('Event Emitted: '+event+', Args: '+args.join(', '))
}

if(!fs.existsSync(__dirname + '/skripts'))
    fs.mkdirSync(__dirname + '/skripts');

app.whenReady().then(() => {
    let icon = nativeImage.createFromPath(__dirname + '/icon.png')
    tray = new Tray(icon)

    contextMenu = Menu.buildFromTemplate([
        { label: "Open Controls", type: 'normal', click: () => {
            shell.openExternal('https://skripter.phazed.xyz')
        }},
        { label: "Stop All Skripts", type: 'normal', click: () => {
            
        }},
        { type: 'separator' },
        { label: "Quit", type: 'normal', click: () => {
            app.quit();
        }}
    ])
      
    tray.setContextMenu(contextMenu)
})

http.createServer((req, res) => {
    let text = decodeURIComponent(req.url.split('/?')[1]);
    if(!text)return;

    if(currentSong !== text.split('(')[0].split('[')[0].trim()){
        fullText = text;
        currentSong = text.split('(')[0].split('[')[0].trim();

        emit('songChange', currentSong, fullText);
    }

    res.end('200 OK');
}).listen(8053);

let server = new ws.Server({ port: 8054 });
let origin = null;

server.on('headers', ( headers, request ) => {
    origin = request.headers.origin;

    setTimeout(() => {
        origin = null;
    }, 100)
})

server.on('connection', ( socket ) => {
    socket._id = randomUUID();
    socket._origin = origin;
    
    emit('connectionRequest', socket._origin, socket._id);
    let authed = false;

    if(!confirmWin){
        confirmWin = new BrowserWindow({
            width: 300,
            height: 150,
            frame: false,
            transparent: true,
            webPreferences: {
                nodeIntegration: true,
                preload: __dirname + '/confirm.js'
            }
        });
    }

    ipcMain.removeAllListeners('confirm');
    ipcMain.removeAllListeners('cancel');

    ipcMain.removeAllListeners('load');
    ipcMain.on('load', () =>
        confirmWin.webContents.send('skript', ( socket._origin || 'A website' ) + ' is requesting skript access'));

    ipcMain.on('confirm', () => {
        sockets.push(socket);
        emit('connectionAllow', socket._origin, socket._id);

        confirmWin.hide();
        authed = true;
    })

    ipcMain.on('cancel', () => {
        emit('connectionRefuse', socket._origin, socket._id);
        confirmWin.hide();
        socket.close()
    })

    confirmWin.show();
    confirmWin.loadFile(__dirname + '/confirm.html');

    socket.on('message', ( msg ) => {
        msg = JSON.parse(msg);

        if(!authed)
            return socket.close();
        
        if(msg.type === 'downloadskript'){
            emit('downloadRequest', msg.url, msg.name);

            if(!confirmWin){
                confirmWin = new BrowserWindow({
                    width: 300,
                    height: 150,
                    frame: false,
                    transparent: true,
                    webPreferences: {
                        nodeIntegration: true,
                        preload: __dirname + '/confirm.js'
                    }
                });
            }
            
            ipcMain.removeAllListeners('confirm');
            ipcMain.removeAllListeners('cancel');

            ipcMain.removeAllListeners('load');
            ipcMain.on('load', () =>
                confirmWin.webContents.send('skript', 'Are you sure you want to download ' + msg.name));

            ipcMain.on('confirm', () => {
                confirmWin.hide();
                emit('downloadStart', msg.url, msg.name);

                fetch(msg.url).then(data => data.text()).then(data => {
                    emit('downloadEnd', msg.url, msg.name);
                    fs.writeFileSync(__dirname + '/skripts/'+msg.name+'.js', data);
                })
            })

            ipcMain.on('cancel', () => {
                emit('downloadRefuse', msg.url, msg.name);
                confirmWin.hide();
            })

            confirmWin.show();
            confirmWin.loadFile(__dirname + '/confirm.html');
        }

        if(msg.type === 'runskript'){
            let runParams = {
                console, process, require, skript: { song: currentSong, rawSong: fullText, on: ( name, cb ) => { events.push({ name, cb }) } }
            }

            vm.createContext(runParams);
            vm.runInContext(fs.readFileSync(__dirname + '/skripts/' + msg.name + '.js'), runParams);
        }

        if(msg.type === 'deleteskript'){
            emit('deleteRequest', msg.name);
            
            if(!confirmWin){
                confirmWin = new BrowserWindow({
                    width: 300,
                    height: 150,
                    frame: false,
                    transparent: true,
                    webPreferences: {
                        nodeIntegration: true,
                        preload: __dirname + '/confirm.js'
                    }
                });
            }
            
            ipcMain.removeAllListeners('confirm');
            ipcMain.removeAllListeners('cancel');

            ipcMain.removeAllListeners('load');
            ipcMain.on('load', () =>
                confirmWin.webContents.send('skript', 'Are you sure you want to delete ' + msg.name));

            ipcMain.on('confirm', () => {
                confirmWin.hide();
                emit('deleteStart', msg.name);

                fs.unlinkSync(__dirname + '/skripts/' + msg.name + '.js');
                emit('deleteEnd', msg.name);
            })

            ipcMain.on('cancel', () => {
                emit('deleteRefuse', msg.name);
                confirmWin.hide();
            })

            confirmWin.show();
            confirmWin.loadFile(__dirname + '/confirm.html');
        }

        if(msg.type === 'readSkriptList'){
            socket.send(JSON.stringify({
                type: 'skriptList',
                skripts: fs.readdirSync(__dirname + '/skripts')
            }))
        }

        if(msg.type === 'getValue'){
            if(msg.key === 'currentSong')
                socket.send(JSON.stringify({ type: 'getValue', key: 'currentSong', value: currentSong }))
            else if(msg.key === 'rawSong')
                socket.send(JSON.stringify({ type: 'getValue', key: 'rawSong', value: fullText }))
        }
    })
})
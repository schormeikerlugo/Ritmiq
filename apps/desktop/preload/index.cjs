// Preload script (CJS porque Electron lo exige).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ritmiq', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  yt: {
    metadata: (idOrUrl) => ipcRenderer.invoke('yt:metadata', idOrUrl),
    streamUrl: (idOrUrl) => ipcRenderer.invoke('yt:streamUrl', idOrUrl),
    search: (query) => ipcRenderer.invoke('yt:search', query),
  },
  ytdlp: {
    info: () => ipcRenderer.invoke('ytdlp:info'),
    update: () => ipcRenderer.invoke('ytdlp:update'),
  },
  library: {
    list: (userId) => ipcRenderer.invoke('library:list', userId),
    addFromYoutube: (payload) => ipcRenderer.invoke('library:addFromYoutube', payload),
    addFromMetadata: (payload) => ipcRenderer.invoke('library:addFromMetadata', payload),
    download: (trackIdOrPayload) => ipcRenderer.invoke('library:download', trackIdOrPayload),
    undownload: (trackId) => ipcRenderer.invoke('library:undownload', trackId),
    fileSize: (trackId) => ipcRenderer.invoke('library:fileSize', trackId),
    syncRemote: (track) => ipcRenderer.invoke('library:syncRemote', track),
    deleteRemote: (trackId) => ipcRenderer.invoke('library:deleteRemote', trackId),
    onDownloadProgress: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('library:download:progress', handler);
      return () => ipcRenderer.removeListener('library:download:progress', handler);
    },
  },
  playlists: {
    list: (userId) => ipcRenderer.invoke('playlists:list', userId),
    upsert: (playlist) => ipcRenderer.invoke('playlists:upsert', playlist),
    delete: (id) => ipcRenderer.invoke('playlists:delete', id),
    tracks: (playlistId) => ipcRenderer.invoke('playlists:tracks', playlistId),
    addTrack: (payload) => ipcRenderer.invoke('playlists:addTrack', payload),
    removeTrack: (payload) => ipcRenderer.invoke('playlists:removeTrack', payload),
    reorder: (payload) => ipcRenderer.invoke('playlists:reorder', payload),
    contents: (userId) => ipcRenderer.invoke('playlists:contents', userId),
  },
});

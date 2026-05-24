// Preload script (CJS porque Electron lo exige).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ritmiq', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  settings: {
    setPublishUrlCache: (enabled) => ipcRenderer.invoke('settings:setPublishUrlCache', enabled),
    getPublishStats: () => ipcRenderer.invoke('settings:getPublishStats'),
    setSupabaseToken: (token) => ipcRenderer.invoke('settings:setSupabaseToken', token),
  },
  lan: {
    clearStreamCache: () => ipcRenderer.invoke('lan:clearStreamCache'),
  },
  yt: {
    metadata: (idOrUrl) => ipcRenderer.invoke('yt:metadata', idOrUrl),
    streamUrl: (idOrUrl) => ipcRenderer.invoke('yt:streamUrl', idOrUrl),
    search: (query) => ipcRenderer.invoke('yt:search', query),
  },
  ytdlp: {
    info: () => ipcRenderer.invoke('ytdlp:info'),
    update: () => ipcRenderer.invoke('ytdlp:update'),
  },
  sharedCache: {
    stats: () => ipcRenderer.invoke('sharedCache:stats'),
    clear: () => ipcRenderer.invoke('sharedCache:clear'),
  },
  tunnel: {
    status: () => ipcRenderer.invoke('tunnel:status'),
    setToken: (token) => ipcRenderer.invoke('tunnel:setToken', token),
    setCustomUrl: (url) => ipcRenderer.invoke('tunnel:setCustomUrl', url),
    start: (opts) => ipcRenderer.invoke('tunnel:start', opts),
    startQuick: () => ipcRenderer.invoke('tunnel:startQuick'),
    stop: () => ipcRenderer.invoke('tunnel:stop'),
    onState: (cb) => {
      const handler = (_e, state) => cb(state);
      ipcRenderer.on('tunnel:state', handler);
      return () => ipcRenderer.removeListener('tunnel:state', handler);
    },
  },
  auth: {
    token: () => ipcRenderer.invoke('auth:token'),
    regenerateToken: () => ipcRenderer.invoke('auth:regenerateToken'),
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
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    pending: () => ipcRenderer.invoke('devices:pending'),
    approve: (deviceId) => ipcRenderer.invoke('devices:approve', deviceId),
    reject: (deviceId) => ipcRenderer.invoke('devices:reject', deviceId),
    revoke: (deviceId) => ipcRenderer.invoke('devices:revoke', deviceId),
    forget: (deviceId) => ipcRenderer.invoke('devices:forget', deviceId),
    rename: (deviceId, name) => ipcRenderer.invoke('devices:rename', { deviceId, name }),
    activity: (deviceId, limit) => ipcRenderer.invoke('devices:activity', { deviceId, limit }),
    onPairRequest: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('devices:pair-request', handler);
      return () => ipcRenderer.removeListener('devices:pair-request', handler);
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

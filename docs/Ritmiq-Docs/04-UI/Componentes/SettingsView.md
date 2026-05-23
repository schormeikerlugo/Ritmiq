---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/SettingsView/SettingsView.jsx
tags: [componente, settings, ajustes, secciones, drill-down]
---

# `SettingsView`

> Vista de Ajustes estilo iOS Settings. Layout plano con secciones H2 + SettingRow. Drill-down hacia subvistas (Account) controlado por `settingsSubview` en [[view]] store.

## Ubicación
`packages/ui/src/components/SettingsView/SettingsView.jsx` (2214 líneas totales — incluye 6 secciones + SettingRow + SettingsGroup + controles)

## Estructura de archivos

```
SettingsView/
  SettingsView.jsx          Entry + layout + drill-down
  SettingsGroup.jsx         Contenedor H2 + lista de SettingRow
  SettingRow.jsx            Fila individual (label + control + description)
  controls/
    Toggle.jsx
    Slider.jsx
    Select.jsx
    ...
  sections/
    AccountSection.jsx      Perfil, avatar, username
    AppearanceSection.jsx   Tema (dark/light/auto) via [[theme]] store
    PlaybackSection.jsx     Crossfade, EQ via [[settings]] store
    ConnectionSection.jsx   LAN, Tunnel, Dispositivos pareados
    StorageSection.jsx      Cache compartido, descargas
    AboutSection.jsx        Versión, yt-dlp, links
```

## Subvistas (drill-down)

```js
settingsSubview = null          → grid principal de secciones
settingsSubview = 'account'     → AccountSection en pantalla completa
```

Controlado por `setSettingsSubview` de [[view]] store.

## Stores consumidos (distribución por sección)

| Sección | Stores |
|---|---|
| Account | [[social]] (`profile`, `updateProfile`, `uploadAvatar`) |
| Appearance | [[theme]] store |
| Playback | [[settings]] store (`setCrossfade`, `setEqEnabled`, `setEqBand`, `setEqPreset`) + [[html-audio-backend]] via `getSharedBackend()` |
| Connection | [[api]] (`tunnelStatus`, `authToken`, etc.) + [[lan-client]] + [[device]] |
| Storage | [[api]] (`sharedCacheStats`, `sharedCacheClear`) + [[local-downloads]] |
| About | [[api]] (`ytdlpInfo`, `ytdlpUpdate`) |

## Notas / Changelog
- 2026-05-22: nivel pleno. Nota simplificada dado el tamaño del componente (2214 líneas con subsecciones).

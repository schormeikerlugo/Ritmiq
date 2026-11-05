---
tipo: componente
capa: ui
plataforma: tv
estado: estable
ultima-revision: 2026-11-05
archivo: packages/ui/src/components/TvNowPlaying/TvNowPlaying.jsx
tags: [tv, reproductor, letras]
---

# `TvNowPlaying` — pantalla "Reproduciendo" de la TV

> Solo en la app de TV: `App.jsx` la monta en lugar del panel lateral [[NowPlaying]] cuando `nowPlayingOpen` (OK sobre la portada de la barra). Portal a `body`, `role=dialog` (la navegación del mando queda dentro), z-index 250 (bajo las ventanas, 300).

## Diseño (1280×720)
- Fondo: miniatura máxima de YouTube (`maxresdefault`, si falla la portada) con degradados; sin desenfoque (onn.).
- Arriba: "Reproduciendo desde <playlist>" y el bloque del código de conexión ([[tv-speaker]]).
- Abajo: portada 128 px + título 44 px + artista; play (foco inicial) + barra de progreso (`role=slider`, ← → ±10 s); anterior, siguiente, aleatorio, repetir, favorito; a la derecha **Letras**, **A continuación**, **Artista**.
- **Letras** (`TvLyrics`): pantalla completa estilo Spotify TV — color sólido de la portada (`getDominantColor` → HSL 40 % de luz, saturación 40–75 %); canción arriba a la izquierda en pequeño (portada 56 px + título + artista); letra en una **columna centrada** de 800 px, 40 px en negrita, la línea actual blanca **a media altura** y el resto en blanco translúcido (cantadas 55 %, siguientes 42 %, escala 0,97 → 1). Animaciones solo de `transform`/`opacity` (desplazamiento 700 ms, cambio de línea 500–600 ms, fundido al abrir) y bordes desvanecidos con `mask-image`. Abajo: barra de tiempo a todo el ancho y controles (play entre anterior y siguiente). En reposo se ocultan los controles, la barra baja 66 px (`translateY`) y la zona de letra crece. Sin sincronizar: texto completo, ↑/↓ desplazan (`role=slider` vertical). CPU medida en el onn. con letra animándose y audio: 30–45 % de un núcleo (de 4).
- **A continuación**: panel lateral con lo añadido desde los móviles (jam) y las 30 siguientes de la cola (`player.playAt(i)`).
- **Artista**: [[ArtistInfoPanel]] en el panel lateral (solo lectura, `inert`).

## Mando
- Atrás (Escape sintético de `__ritmiqTvBack`): cierra el panel/letra y luego la pantalla; el foco vuelve a donde estaba.
- Reposo: 8 s sin teclas, sonando, sin panel (o con la letra) → se ocultan cabecera, play y controles; el hueco del play se cierra (barra a todo el ancho) y el bloque inferior baja 70 px (`translateY`); la primera tecla solo despierta (`setTvKeyInterceptor` de [[tv-nav]]).

## Notas / Changelog
- 2026-11-05 (c): en la vista normal también baja la barra en reposo.
- 2026-11-05 (b): letra centrada como Spotify TV, cabecera de canción arriba, barra baja en reposo, animaciones suaves.
- 2026-11-05: creación. Verificado en el onn.: apertura desde la barra, seek ±10 s, recorrido de controles, letra sincronizada, cola (OK reproduce), Atrás, reposo; CPU ~0 % en reposo.

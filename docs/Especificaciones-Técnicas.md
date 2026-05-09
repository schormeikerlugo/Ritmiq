# Especificaciones Técnicas: Proyecto Reproductor de Música (Inspiración Demus)

Este documento detalla el funcionamiento técnico para la integración de streaming (YouTube), gestión de metadatos y sincronización de listas de reproducción externas para una aplicación de gestión musical local y remota.

## 1. Arquitectura de Captura y Streaming (YouTube)

Demus no almacena los videos, sino que actúa como un "wrapper" o cliente de visualización de contenido. pero en mi aplicacion deberia poder descargar las canciones y escucharlas sin necesidad de internet.

### Mecanismos de Reproducción sin Publicidad
*   **Inyección de Scripts (WebView):** Para saltar anuncios, se puede utilizar un componente de WebView que inyecte JavaScript para ocultar elementos de publicidad (`ad-slot`, `overlay`) y acelerar o saltar los videos de anuncios detectados.
*   **Extracción de Streams (YTDL-Core / yt-dlp):** En un entorno local (Node.js o Python), puedes usar librerías como `yt-dlp` para obtener la URL directa del stream de audio/video (`manifest URL`). Esto evita cargar la interfaz pesada de YouTube y sus anuncios.
*   **Proxy de Audio:** Capturar el flujo de datos y enviarlo a un reproductor nativo de HTML5 o móvil para permitir la reproducción en segundo plano (Background Audio).

## 2. Gestión de Listas de Reproducción y Almacenamiento

Para tu app local, el sistema debe ser híbrido (archivos físicos + enlaces de streaming).

### Características del Sistema de Listas
*   **Base de Datos Local (SQLite/IndexedDB):** Almacenar punteros a archivos locales (ruta en el disco) y IDs de YouTube en una misma tabla para crear listas "mixtas".
*   **Estructura de Metadatos:**
    *   `ID_Cancion`: Único.
    *   `Source`: "Local" o "YouTube".
    *   `Path_URL`: Ruta del archivo o ID del video.
    *   `Metadata`: Título, artista y carátula (obtenidos vía API o tags ID3).

## 3. Integración y Exportación de Terceros (Spotify / Apple Music)

Demus no "mueve" los archivos de Spotify, sino que hace un **Matching de Metadatos**.

### Proceso de Importación (Mapping)
1.  **Captura de Datos:** Se obtienen los nombres de canciones y artistas desde la API de Spotify o mediante el parsing de un enlace compartido.
2.  **Búsqueda Automática:** La app realiza una búsqueda interna en la API de YouTube buscando: `Nombre de la canción + Artista + "Topic"`.
3.  **Vinculación (Matching):** Se selecciona el resultado más relevante y se guarda el ID de YouTube en la base de datos local de tu app.
4.  **Exportación:** Para exportar, la app genera un archivo `.JSON` o `.CSV` con los metadatos que pueda ser leído por otras herramientas de gestión de música (como Soundiiz o TuneMyMusic).

## 4. Funcionamiento en Red Local (PC y Móvil)

Para gestionar tu propia app entre dispositivos sin depender de servidores externos:

*   **Servidor Backend Local:** Usaremos un servidor de supabase que podria ayudar a gestionar las cuentas de usuario y las canciones descargadas por el usuario. con supabase puedes crear usuarios, roles, permisos, etc y ademas tiene una base de datos postgresql que puedes usar para almacenar informacion de tu aplicacion. tomando en cuenta que se puede usar offline desde el movil o la pc. el usuario se autentica con supabase y los datos de sus canciones y listas se sincronizan con supabase. usaremos supabase edge functions para poder ejecutar logica de negocio en el backend. y usaremos rpc para interactuar con la base de datos y ejecutar logica de negocio. de esta forma se tiene un backend mas seguro y escalable. usaremos supabase auth para gestionar las cuentas de usuario. usaremos supabase storage para almacenar las carátulas de las canciones.

*   **Descubrimiento de Red:** Usar protocolos como **mDNS/Bonjour** para que la app del teléfono encuentre automáticamente la dirección IP de tu PC en la red Wi-Fi de casa o en la misma red local. y que tenga una ip publica para poder acceder desde cualquier lugar (Dns dinamico)

*   **Sincronización:** Implementar un sistema de sincronización simple donde el teléfono descargue la base de datos (SQLite) del PC al iniciar o que se mantenga en tiempo real con supabase.

## 5. Recomendaciones en la pantalla de Inicio (fase futura)

La pantalla "Inicio" (`Home`) hoy muestra accesos rápidos a la biblioteca y a las playlists del usuario. En una fase posterior debe mostrar **recomendaciones personalizadas**.

### Fuentes de datos para recomendar
*   **Historial de reproducción** (`play_history`): canciones más escuchadas, frecuencia, último mes.
*   **Favoritas y playlists**: artistas y géneros más representados.
*   **Skips/repetitions**: pistas que el usuario salta vs las que repite.

### Estrategias técnicas
1.  **Recomendación basada en artistas/canales**: para cada artista en favoritas, buscar en YouTube las pistas relacionadas vía `ytsearch:<artista>` y filtrar las que aún no estén en biblioteca.
2.  **Last.fm o MusicBrainz API**: enriquecer cada track con géneros y artistas similares; recomendar por afinidad.
3.  **Edge Function de Supabase** (`recommend`): ejecuta la lógica en el servidor para que móvil y desktop reciban las mismas sugerencias.
4.  **Embeddings (avanzado)**: generar embeddings de letras/títulos vía Supabase pgvector y hacer búsqueda por similitud.

### Componentes UI a construir
*   Sección "Hechas para ti" con carruseles horizontales.
*   "Continuar escuchando" basado en `play_history` reciente.
*   "Más de tus artistas favoritos".
*   "Descubre" con tracks aún no escuchados pero relacionados.

### Tracking
Habilitar inserción en `play_history` cuando una canción supere ~30s reproducidos para alimentar el modelo.


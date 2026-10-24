/**
 * Límites comunes a todos los formatos (STL, OBJ y 3MF). Protegen la pestaña ante archivos
 * enormes o hechos a propósito para agotar la memoria: se comprueban en la interfaz (antes de
 * leer el archivo) y otra vez en el análisis (dentro del worker), por si llega por otro camino.
 */

/** Tamaño máximo del archivo: 300 MB. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;

/**
 * Tope de triángulos de la malla resultante. En un STL binario de 300 MB (300 MiB) caben
 * (300 × 1024 × 1024 − 84) / 50 ≈ 6 291 454 triángulos: el tope queda justo por encima para que
 * cualquier STL que pase el límite de tamaño se pueda abrir. Ocupan ~227 MB como `Float32Array`.
 * Un OBJ puede declarar muchos más con muy pocos bytes (una cara de mil índices son 998
 * triángulos), así que se corta al leerlo, antes de reservar memoria.
 */
export const MAX_TRIANGLES = 6_300_000;

/**
 * El tope para los mensajes de error, con espacios duros como separador de miles («6 300 000»):
 * vale igual en español y en inglés y no depende de la coma o el punto decimal de cada idioma.
 */
export const MAX_TRIANGLES_TEXT = String(MAX_TRIANGLES).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

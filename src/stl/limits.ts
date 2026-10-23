/**
 * Límites comunes a todos los formatos (STL, OBJ y 3MF). Protegen la pestaña ante archivos
 * enormes o hechos a propósito para agotar la memoria: se comprueban en la interfaz (antes de
 * leer el archivo) y otra vez en el análisis (dentro del worker), por si llega por otro camino.
 */

/** Tamaño máximo del archivo: 300 MB. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;

/**
 * Tope de triángulos de la malla resultante. 6 millones son los que caben en un STL binario de
 * 300 MB y ocupan 216 MB como `Float32Array`. Un OBJ puede declarar muchos más con muy pocos bytes
 * (una cara de mil índices son 998 triángulos), así que se corta al leerlo, antes de reservar memoria.
 */
export const MAX_TRIANGLES = 6_000_000;

/** El tope en millones, para los mensajes de error. */
export const MAX_TRIANGLES_MILLIONS = MAX_TRIANGLES / 1_000_000;

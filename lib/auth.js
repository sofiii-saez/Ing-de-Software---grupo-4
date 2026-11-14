// Autenticación del panel de administración (HU-07).
//
// Lo que comprometimos en el alcance: acceso con usuario y contraseña, contraseñas encriptadas y
// credenciales fuera del código y del repositorio.
//   - La contraseña se guarda como hash scrypt con sal aleatoria (módulo crypto de Node).
//   - El usuario y el hash viven en .env (ADMIN_USER, ADMIN_PASS_HASH), que no se sube a GitHub.
//     Se generan con: npm run crear-admin
//   - Al iniciar sesión se entrega una cookie HttpOnly + SameSite=Strict con un token aleatorio
//     que vence a las 2 horas.
//   - Después de 5 intentos fallidos desde la misma IP, se bloquea el login por 15 minutos.

const crypto = require("crypto");

const DURACION_SESION_MS = 2 * 60 * 60 * 1000;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

function hashClave(clave, sal = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(clave), sal, 64).toString("hex");
  return `scrypt$${sal}$${hash}`;
}

function verificarClave(clave, guardado) {
  const [alg, sal, hash] = String(guardado || "").split("$");
  if (alg !== "scrypt" || !sal || !hash) return false;
  const calculado = Buffer.from(hashClave(clave, sal).split("$")[2], "hex");
  const esperado = Buffer.from(hash, "hex");
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

class Autenticacion {
  /** @param {{ usuario: string, hash: string, ahora?: () => number }} config */
  constructor({ usuario, hash, ahora = Date.now }) {
    this.usuario = usuario;
    this.hash = hash;
    this.ahora = ahora;
    this.sesiones = new Map();       // token → { usuario, vence }
    this.intentos = new Map();       // ip → { fallos, desde }
  }

  configurada() { return Boolean(this.usuario && this.hash); }

  bloqueada(ip) {
    const i = this.intentos.get(ip);
    if (!i) return false;
    if (this.ahora() - i.desde > BLOQUEO_MS) { this.intentos.delete(ip); return false; }
    return i.fallos >= MAX_INTENTOS;
  }

  /**
   * Intenta iniciar sesión.
   * @returns {{ token?: string, error?: string }}
   */
  iniciarSesion(usuario, clave, ip = "local") {
    if (!this.configurada()) return { error: "El panel no tiene un administrador configurado (npm run crear-admin)." };
    if (this.bloqueada(ip)) return { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.", bloqueado: true };
    const usuarioOk = String(usuario || "") === this.usuario;
    const claveOk = verificarClave(clave, this.hash);       // se calcula siempre, para no delatar qué falló
    if (!usuarioOk || !claveOk) {
      const i = this.intentos.get(ip) || { fallos: 0, desde: this.ahora() };
      i.fallos += 1;
      this.intentos.set(ip, i);
      return { error: "Usuario o contraseña incorrectos." };
    }
    this.intentos.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    this.sesiones.set(token, { usuario: this.usuario, vence: this.ahora() + DURACION_SESION_MS });
    return { token };
  }

  /** Devuelve el usuario de la sesión, o null si el token no existe o venció. */
  validarSesion(token) {
    const s = token && this.sesiones.get(token);
    if (!s) return null;
    if (this.ahora() > s.vence) { this.sesiones.delete(token); return null; }
    return s.usuario;
  }

  cerrarSesion(token) { this.sesiones.delete(token); }
}

module.exports = { Autenticacion, hashClave, verificarClave, DURACION_SESION_MS, MAX_INTENTOS };

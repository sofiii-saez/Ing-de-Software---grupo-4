// Pruebas unitarias de la autenticación del panel.   node --test test/auth.test.js
const test = require("node:test");
const assert = require("node:assert");
const { Autenticacion, hashClave, verificarClave, DURACION_SESION_MS, MAX_INTENTOS } = require("../lib/auth");

const HASH = hashClave("clave-segura-123");

test("la contraseña se guarda como hash con sal (nunca en texto plano)", () => {
  assert.ok(HASH.startsWith("scrypt$"));
  assert.ok(!HASH.includes("clave-segura-123"));
  assert.notStrictEqual(hashClave("clave-segura-123"), HASH);      // sal distinta → hash distinto
});

test("verificarClave acepta la correcta y rechaza las demás", () => {
  assert.ok(verificarClave("clave-segura-123", HASH));
  assert.ok(!verificarClave("otra", HASH));
  assert.ok(!verificarClave("clave-segura-123", "texto-cualquiera"));
});

test("login correcto entrega un token válido; logout lo invalida", () => {
  const auth = new Autenticacion({ usuario: "admin", hash: HASH });
  const { token } = auth.iniciarSesion("admin", "clave-segura-123");
  assert.strictEqual(auth.validarSesion(token), "admin");
  auth.cerrarSesion(token);
  assert.strictEqual(auth.validarSesion(token), null);
});

test("login con usuario o contraseña incorrectos falla con el mismo mensaje", () => {
  const auth = new Autenticacion({ usuario: "admin", hash: HASH });
  const a = auth.iniciarSesion("admin", "mala");
  const b = auth.iniciarSesion("otro", "clave-segura-123");
  assert.ok(a.error && !a.token);
  assert.strictEqual(a.error, b.error);
});

test("la sesión vence después de 2 horas", () => {
  let ahora = 0;
  const auth = new Autenticacion({ usuario: "admin", hash: HASH, ahora: () => ahora });
  const { token } = auth.iniciarSesion("admin", "clave-segura-123");
  ahora = DURACION_SESION_MS + 1;
  assert.strictEqual(auth.validarSesion(token), null);
});

test(`después de ${MAX_INTENTOS} intentos fallidos se bloquea el login, incluso con la clave correcta`, () => {
  const auth = new Autenticacion({ usuario: "admin", hash: HASH });
  for (let i = 0; i < MAX_INTENTOS; i++) auth.iniciarSesion("admin", "mala", "1.2.3.4");
  assert.ok(auth.iniciarSesion("admin", "clave-segura-123", "1.2.3.4").bloqueado);
  assert.ok(auth.iniciarSesion("admin", "clave-segura-123", "5.6.7.8").token);   // otra IP no se ve afectada
});

test("sin administrador configurado no se puede entrar", () => {
  const auth = new Autenticacion({ usuario: "", hash: "" });
  assert.ok(auth.iniciarSesion("", "").error);
});

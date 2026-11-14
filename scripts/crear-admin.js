// Crea (o cambia) el usuario administrador del panel y lo guarda en .env.
// La contraseña NO se guarda: solo su hash scrypt. Uso:  npm run crear-admin
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { hashClave } = require("../lib/auth");

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const usuario = (await rl.question("Usuario administrador: ")).trim();
  const clave = await rl.question("Contraseña (mínimo 10 caracteres): ");
  rl.close();
  if (!/^[\w.@-]{3,40}$/.test(usuario)) { console.error("Usuario no válido (3 a 40 letras, números, . _ - @)."); process.exit(1); }
  if (clave.length < 10) { console.error("La contraseña debe tener al menos 10 caracteres."); process.exit(1); }

  const rutaEnv = path.join(__dirname, "..", ".env");
  let env = fs.existsSync(rutaEnv) ? fs.readFileSync(rutaEnv, "utf8") : fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  const poner = (clave, valor) => {
    const re = new RegExp(`^${clave}=.*$`, "m");
    env = re.test(env) ? env.replace(re, `${clave}=${valor}`) : `${env.trimEnd()}\n${clave}=${valor}\n`;
  };
  poner("ADMIN_USER", usuario);
  poner("ADMIN_PASS_HASH", hashClave(clave));
  fs.writeFileSync(rutaEnv, env);
  console.log(`\n✅ Administrador "${usuario}" guardado en .env (solo el hash de la contraseña). Reinicia el servidor.`);
}
main();

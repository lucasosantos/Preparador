#!/usr/bin/env bash
# Compila os instaladores nesta máquina (Linux) e, opcionalmente, publica numa Release do GitHub.
#
#   scripts/release.sh                  testa e gera AppImage (Linux) e -setup.exe (Windows, NSIS)
#   scripts/release.sh --so-linux       só o AppImage
#   scripts/release.sh --so-windows     só o instalador de Windows
#   scripts/release.sh --versao 0.2.0   troca a versão em package.json, tauri.conf.json e Cargo.toml antes
#   scripts/release.sh --publicar       depois de compilar: cria a tag vX.Y.Z, faz push e anexa os
#                                       instaladores a uma release em rascunho (precisa do gh logado)
#
# O Windows é compilado por compilação cruzada (cargo-xwin + NSIS). O .msi não é gerado: o WiX só roda no Windows.
# Os instaladores ficam em release/vX.Y.Z/ (fora do git) e vão para a Release, não para os commits.
set -euo pipefail
cd "$(dirname "$0")/.."

LINUX=1
WINDOWS=1
PUBLICAR=0
NOVA_VERSAO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --so-linux) WINDOWS=0 ;;
    --so-windows) LINUX=0 ;;
    --publicar) PUBLICAR=1 ;;
    --versao) NOVA_VERSAO="${2:?informe a versão, ex.: --versao 0.2.0}"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1 (veja --help)"; exit 1 ;;
  esac
  shift
done

etapa() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
erro() { printf '\033[1;31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

if [ -n "$NOVA_VERSAO" ]; then
  [[ "$NOVA_VERSAO" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || erro "versão deve ser X.Y.Z"
  etapa "Versão $NOVA_VERSAO"
  node -e '
    const fs = require("fs"), v = process.argv[1];
    for (const f of ["package.json", "src-tauri/tauri.conf.json"]) {
      const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = v;
      fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    }
    const c = "src-tauri/Cargo.toml";
    fs.writeFileSync(c, fs.readFileSync(c, "utf8").replace(/^version = ".*"$/m, `version = "${v}"`));
  ' "$NOVA_VERSAO"
fi
VERSAO=$(node -p 'require("./src-tauri/tauri.conf.json").version')
TAG="v$VERSAO"
SAIDA="release/$TAG"

# ---------- dependências ----------
etapa "Conferindo dependências"
faltando=()
precisa() { command -v "$1" >/dev/null || faltando+=("$1 ($2)"); }
precisa node "https://nodejs.org"
precisa cargo "https://rustup.rs"
if [ $LINUX = 1 ]; then
  for lib in webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0 librsvg-2.0 openssl; do
    pkg-config --exists "$lib" 2>/dev/null || faltando+=("$lib (sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev)")
  done
  precisa file "sudo apt install file"
fi
if [ $WINDOWS = 1 ]; then
  rustup target list --installed | grep -qx x86_64-pc-windows-msvc || faltando+=("alvo Rust x86_64-pc-windows-msvc (rustup target add x86_64-pc-windows-msvc)")
  precisa cargo-xwin "cargo install --locked cargo-xwin"
  precisa makensis "sudo apt install nsis"
  precisa clang "sudo apt install clang"
  precisa lld-link "sudo apt install lld"
  precisa llvm-rc "sudo apt install llvm"
fi
if [ $PUBLICAR = 1 ]; then
  precisa gh "https://cli.github.com"
  precisa git "sudo apt install git"
fi
if [ ${#faltando[@]} -gt 0 ]; then
  printf '  falta: %s\n' "${faltando[@]}"
  erro "instale o que falta e rode de novo."
fi
if [ $PUBLICAR = 1 ]; then
  git rev-parse --git-dir >/dev/null 2>&1 || erro "esta pasta não é um repositório git."
  gh auth status >/dev/null 2>&1 || erro "faça login no GitHub CLI: gh auth login"
  [ -z "$(git status --porcelain)" ] || erro "há mudanças sem commit. Faça o commit (inclusive da troca de versão) antes de publicar."
  ! git rev-parse "$TAG" >/dev/null 2>&1 || erro "a tag $TAG já existe. Use --versao para uma versão nova."
fi
echo "Tudo certo. Versão $VERSAO."

# ---------- testes ----------
[ -d node_modules ] || { etapa "Instalando dependências do npm"; npm ci; }
etapa "Type-check e testes"
npm run check
npm test

# ---------- builds ----------
mkdir -p "$SAIDA"
if [ $LINUX = 1 ]; then
  etapa "Compilando Linux (AppImage)"
  npm run tauri build -- --bundles appimage
  cp src-tauri/target/release/bundle/appimage/*_"$VERSAO"_*.AppImage "$SAIDA"/
fi
if [ $WINDOWS = 1 ]; then
  etapa "Compilando Windows (instalador NSIS, compilação cruzada)"
  npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
  cp src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*_"$VERSAO"_*-setup.exe "$SAIDA"/
fi
(cd "$SAIDA" && sha256sum -- * | grep -v SHA256SUMS > SHA256SUMS.txt)

etapa "Instaladores em $SAIDA"
ls -lh "$SAIDA"

# ---------- publicar ----------
if [ $PUBLICAR = 1 ]; then
  etapa "Publicando $TAG"
  git tag -a "$TAG" -m "Preparador $TAG"
  git push origin HEAD
  git push origin "$TAG"
  gh release create "$TAG" "$SAIDA"/* --draft --title "Preparador $TAG" --notes "Baixe o instalador do seu sistema:
- **Windows:** \`Preparador_${VERSAO}_x64-setup.exe\`
- **Linux:** \`Preparador_${VERSAO}_amd64.AppImage\` (dê permissão de execução e abra)

\`SHA256SUMS.txt\` traz os checksums para conferir os downloads."
  echo
  echo "Rascunho criado. Revise e publique em: $(gh release view "$TAG" --json url -q .url)"
fi

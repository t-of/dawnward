# DAWNWARD

T.OF... のアプリ。https://t-of.github.io/dawnward/

- ルールは本部の `~/GitHub/tof/t-of.github.io/RULES.md` に従う（全アプリ共通）。ブランドは `docs/BRAND.md`。
- 直したら本部で `npm run audit:browser -- dawnward` を通す。
- 公開は本部の `docs/RELEASE.md` の手順。大きな作業は本部で Claude を起動すると、役割を分けて進められる。
- localStorage のキーは `dawnward.` で始める。SW のキャッシュ名は `dawnward-` で始める。
- 決まりは `logic.js`（DOM に触らない）。変えたら `node test.mjs` を通す。バランスを変えたら `node tools/balance.mjs` で測り直し、README の「バランス」を書き直す。

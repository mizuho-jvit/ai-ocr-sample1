/**
 * 🔵 Intent: `import.meta.env.DEV` はViteが`vite build`/`vite`(dev)双方で静的に
 * 提供する値(本番ビルドではfalseへ畳み込まれデッドコード除去される)。
 * Workers用tsconfigには`vite/client`を含めていないため、使用箇所(index.ts)の
 * 最小限の型のみをここで補う。
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

# How to use

To run the `codemods` for convert exports * to export individual components, just run

```sh
npm install
npm run transform -- <path-to-index.ts>
```

You may just want to `dry-run` first:

```sh
npm run transform -- <path-to-index.ts> -d
```

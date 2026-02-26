# create-dalila

Scaffold a new Dalila project with one command.

## Usage

```bash
npm create dalila@latest my-app
cd my-app
npm install
npm run dev
```

Open http://localhost:4242 to see your app.

## Requirements

- Node.js `>=22.6.0`

## What's Included

- File-based router starter (`src/app`)
- Dev server + route generation watcher
- TypeScript support out of the box
- Minimal CSS styling

## Project Structure

```
my-app/
├── dev.mjs         # Runs route watcher + dev server
├── index.html      # App shell
├── src/
│   ├── app/
│   │   ├── layout.html
│   │   ├── page.html
│   │   └── page.ts
│   ├── main.ts     # Router bootstrap
│   └── style.css   # Styles
├── package.json
└── tsconfig.json
```

## Scripts

- `npm run dev` - Start dev server and route watcher
- `npm run routes` - Generate route files once
- `npm run routes:watch` - Watch route files and regenerate outputs
- `npm run build` - Compile TypeScript

## Learn More

- [Dalila Documentation](https://github.com/evertondsvieira/dalila)

# ai-dead-code

Find unused exports, functions, and variables in your JavaScript/TypeScript codebase.

## Install

```bash
npx ai-dead-code
```

## What it does

- Finds exports that are never imported elsewhere
- Detects functions that are defined but never called
- Identifies potentially dead code for cleanup
- Works with JS, TS, JSX, and TSX files

## Usage

```bash
# Scan current directory
npx ai-dead-code

# Scan specific directory
npx ai-dead-code -d ./src

# Only check exports (higher confidence)
npx ai-dead-code --exports-only

# Custom extensions
npx ai-dead-code -e js,mjs,cjs

# Ignore specific patterns
npx ai-dead-code --ignore "**/generated/**,**/vendor/**"

# Output JSON report
npx ai-dead-code -o dead-code.json
```

## Example Output

```
🔍 Dead Code Finder

✔ Scanned 127 files

📊 Results

Total exports found: 234
Total functions found: 512

🚨 Potentially Unused Exports: 8

  src/utils/deprecated.ts
    → export formatLegacyDate
    → export parseLegacyFormat
  
  src/api/oldClient.ts
    → export default OldApiClient
  
  src/helpers/unused.ts
    → export helperThatNobodyUses

⚠️  Potentially Unused Functions: 14

  src/utils/helpers.ts
    → function internalHelper
    → const unusedCalculation
  
  src/components/Form.tsx
    → function validateLegacy

📋 Summary

  Dead code found: 22 items
  Unused exports: 8
  Unused functions: 14

⚠️  Note: Some "unused" code may be used dynamically or in entry points.
   Review before deleting. Run with --exports-only for higher confidence.
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --dir <path>` | Directory to scan | `.` |
| `-e, --extensions <ext>` | File extensions | `js,ts,jsx,tsx` |
| `--ignore <patterns>` | Patterns to ignore | - |
| `--exports-only` | Only check exports | false |
| `-o, --output <file>` | Save JSON report | - |

## What it skips

- `node_modules/`
- `dist/` and `build/`
- Test files (`*.test.*`, `*.spec.*`, `__tests__/`)
- Type definitions (`*.d.ts`)
- Index files (often re-export)

## Confidence Levels

| Finding | Confidence |
|---------|------------|
| Unused named export | High |
| Unused default export | High |
| Unused local function | Medium |
| Unused arrow function | Medium |

## Tips

1. **Start with --exports-only** for high-confidence cleanup
2. **Review before deleting** - some code may be used dynamically
3. **Check entry points** - main.ts, app.tsx are intentionally exported
4. **Run regularly** - prevents dead code accumulation

## License

MIT

---

Built by LXGIC Studios
🔗 [GitHub](https://github.com/lxgicstudios) · [Twitter](https://twitter.com/lxgicstudios)
💡 Want more free tools like this? We have 100+ on our GitHub: github.com/lxgicstudios

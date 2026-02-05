#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const { glob } = require('glob');
const fs = require('fs');
const path = require('path');

program
  .name('ai-dead-code')
  .description('Find unused exports, functions, and variables in your codebase')
  .version('1.0.0')
  .option('-d, --dir <path>', 'Directory to scan', '.')
  .option('-e, --extensions <ext>', 'File extensions to scan', 'js,ts,jsx,tsx')
  .option('--ignore <patterns>', 'Glob patterns to ignore', '')
  .option('--exports-only', 'Only check for unused exports')
  .option('-o, --output <file>', 'Output report to file')
  .parse(process.argv);

const opts = program.opts();

async function scanFiles() {
  const extensions = opts.extensions.split(',').map(e => e.trim());
  const patterns = extensions.map(ext => `${opts.dir}/**/*.${ext}`);
  
  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/__tests__/**',
    '**/*.d.ts',
  ];
  
  if (opts.ignore) {
    ignorePatterns.push(...opts.ignore.split(',').map(p => p.trim()));
  }
  
  const files = await glob(patterns, { ignore: ignorePatterns });
  return files;
}

function extractExports(content, filePath) {
  const exports = [];
  
  // Named exports: export const/let/var/function/class
  const namedExportRegex = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
  let match;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push({ name: match[1], type: 'named', file: filePath });
  }
  
  // Export { name } from or export { name }
  const exportListRegex = /export\s*\{([^}]+)\}/g;
  while ((match = exportListRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const trimmed = n.trim();
      // Handle "name as alias" - we want the original name
      const asParts = trimmed.split(/\s+as\s+/);
      return asParts[0].trim();
    }).filter(Boolean);
    names.forEach(name => {
      if (name !== 'default') {
        exports.push({ name, type: 'named', file: filePath });
      }
    });
  }
  
  // Default export with name: export default function name() or export default class Name
  const defaultNamedRegex = /export\s+default\s+(?:function|class|async\s+function)\s+(\w+)/g;
  while ((match = defaultNamedRegex.exec(content)) !== null) {
    exports.push({ name: match[1], type: 'default', file: filePath });
  }
  
  return exports;
}

function extractFunctions(content, filePath) {
  const functions = [];
  
  // Regular functions: function name()
  const funcRegex = /(?<!export\s+)function\s+(\w+)\s*\(/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    functions.push({ name: match[1], type: 'function', file: filePath });
  }
  
  // Arrow functions: const name = () => or const name = async () =>
  const arrowRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    functions.push({ name: match[1], type: 'arrow', file: filePath });
  }
  
  // Arrow functions: const name = async () => or const name = param =>
  const arrowSimpleRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\w+\s*=>/g;
  while ((match = arrowSimpleRegex.exec(content)) !== null) {
    functions.push({ name: match[1], type: 'arrow', file: filePath });
  }
  
  return functions;
}

function findUsages(name, content, definingFile, currentFile) {
  // Skip if it's in the same file as definition (self-reference is okay)
  // But we want to find usages across files
  
  // Create regex that matches the name as a word boundary
  // Exclude the export/const/function declarations
  const usageRegex = new RegExp(`(?<!(?:export\\s+(?:const|let|var|function|class|async\\s+function)\\s+|function\\s+|const|let|var\\s+))\\b${name}\\b`, 'g');
  
  const matches = content.match(usageRegex);
  return matches ? matches.length : 0;
}

function findImports(content) {
  const imports = new Set();
  
  // import { name } from 'module'
  const namedImportRegex = /import\s*\{([^}]+)\}\s*from/g;
  let match;
  while ((match = namedImportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const trimmed = n.trim();
      // Handle "name as alias" - we want the alias (what's actually used)
      const asParts = trimmed.split(/\s+as\s+/);
      return asParts[asParts.length - 1].trim();
    }).filter(Boolean);
    names.forEach(name => imports.add(name));
  }
  
  // import name from 'module'
  const defaultImportRegex = /import\s+(\w+)\s+from/g;
  while ((match = defaultImportRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  
  // import * as name from 'module'
  const namespaceImportRegex = /import\s+\*\s+as\s+(\w+)\s+from/g;
  while ((match = namespaceImportRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  
  // require('module')
  const requireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(/g;
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1]) {
      // Destructured require
      const names = match[1].split(',').map(n => n.trim().split(/\s*:\s*/)[0]).filter(Boolean);
      names.forEach(name => imports.add(name));
    } else if (match[2]) {
      imports.add(match[2]);
    }
  }
  
  return imports;
}

async function main() {
  console.log(chalk.bold('\n🔍 Dead Code Finder\n'));
  
  const spinner = ora('Scanning files...').start();
  
  const files = await scanFiles();
  spinner.text = `Analyzing ${files.length} files...`;
  
  // First pass: collect all exports and functions
  const allExports = [];
  const allFunctions = [];
  const fileContents = new Map();
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      fileContents.set(file, content);
      
      const exports = extractExports(content, file);
      allExports.push(...exports);
      
      if (!opts.exportsOnly) {
        const functions = extractFunctions(content, file);
        allFunctions.push(...functions);
      }
    } catch (err) {
      // Skip unreadable files
    }
  }
  
  spinner.text = 'Finding unused code...';
  
  // Second pass: find usages across all files
  const unusedExports = [];
  const unusedFunctions = [];
  
  // Check exports
  for (const exp of allExports) {
    let totalUsages = 0;
    const relPath = path.relative(opts.dir, exp.file);
    
    // Skip index files and entry points
    if (relPath.match(/index\.[jt]sx?$/) || relPath.match(/main\.[jt]sx?$/) || relPath.match(/app\.[jt]sx?$/i)) {
      continue;
    }
    
    for (const [file, content] of fileContents) {
      if (file === exp.file) continue; // Skip self
      
      // Check if this file imports from the export's file
      const imports = findImports(content);
      
      if (imports.has(exp.name)) {
        totalUsages++;
      }
      
      // Also check for dynamic usage
      const regex = new RegExp(`\\b${exp.name}\\b`);
      if (regex.test(content) && file !== exp.file) {
        // Could be a usage or coincidence, count it
        totalUsages++;
      }
    }
    
    // Dedupe and if no usage found
    if (totalUsages === 0) {
      unusedExports.push(exp);
    }
  }
  
  // Check functions (non-exported)
  if (!opts.exportsOnly) {
    for (const func of allFunctions) {
      // Skip if it's also exported
      if (allExports.some(e => e.name === func.name && e.file === func.file)) {
        continue;
      }
      
      const content = fileContents.get(func.file);
      if (!content) continue;
      
      // Count usages in the same file (excluding the definition)
      const funcNameRegex = new RegExp(`\\b${func.name}\\s*\\(`, 'g');
      const matches = content.match(funcNameRegex);
      const usageCount = matches ? matches.length - 1 : 0; // Subtract 1 for definition
      
      if (usageCount <= 0) {
        // Check if it might be used via callback or passed as reference
        const refRegex = new RegExp(`[^\\w]${func.name}[^\\w(]`, 'g');
        const refMatches = content.match(refRegex);
        if (!refMatches || refMatches.length === 0) {
          unusedFunctions.push(func);
        }
      }
    }
  }
  
  spinner.succeed(`Scanned ${files.length} files`);
  
  // Display results
  console.log(chalk.bold('\n📊 Results\n'));
  
  const totalExports = allExports.length;
  const totalFunctions = allFunctions.length;
  
  console.log(`Total exports found: ${chalk.cyan(totalExports)}`);
  if (!opts.exportsOnly) {
    console.log(`Total functions found: ${chalk.cyan(totalFunctions)}`);
  }
  
  if (unusedExports.length === 0 && unusedFunctions.length === 0) {
    console.log(chalk.green('\n✅ No dead code detected!\n'));
    return;
  }
  
  // Unused exports
  if (unusedExports.length > 0) {
    console.log(chalk.bold.red(`\n🚨 Potentially Unused Exports: ${unusedExports.length}\n`));
    
    // Group by file
    const byFile = {};
    for (const exp of unusedExports) {
      const relPath = path.relative(opts.dir, exp.file);
      if (!byFile[relPath]) byFile[relPath] = [];
      byFile[relPath].push(exp);
    }
    
    Object.entries(byFile).forEach(([file, exports]) => {
      console.log(chalk.cyan(`  ${file}`));
      exports.forEach(exp => {
        console.log(`    ${chalk.yellow('→')} export ${exp.type === 'default' ? 'default ' : ''}${chalk.bold(exp.name)}`);
      });
    });
  }
  
  // Unused functions
  if (!opts.exportsOnly && unusedFunctions.length > 0) {
    console.log(chalk.bold.yellow(`\n⚠️  Potentially Unused Functions: ${unusedFunctions.length}\n`));
    
    // Group by file
    const byFile = {};
    for (const func of unusedFunctions) {
      const relPath = path.relative(opts.dir, func.file);
      if (!byFile[relPath]) byFile[relPath] = [];
      byFile[relPath].push(func);
    }
    
    Object.entries(byFile).slice(0, 10).forEach(([file, funcs]) => {
      console.log(chalk.cyan(`  ${file}`));
      funcs.slice(0, 5).forEach(func => {
        console.log(`    ${chalk.yellow('→')} ${func.type === 'arrow' ? 'const ' : 'function '}${chalk.bold(func.name)}`);
      });
      if (funcs.length > 5) {
        console.log(chalk.gray(`    ... and ${funcs.length - 5} more`));
      }
    });
    
    if (Object.keys(byFile).length > 10) {
      console.log(chalk.gray(`\n  ... and ${Object.keys(byFile).length - 10} more files`));
    }
  }
  
  // Summary
  const totalDead = unusedExports.length + unusedFunctions.length;
  console.log(chalk.bold(`\n📋 Summary\n`));
  console.log(`  Dead code found: ${chalk.red(totalDead)} items`);
  console.log(`  Unused exports: ${chalk.red(unusedExports.length)}`);
  if (!opts.exportsOnly) {
    console.log(`  Unused functions: ${chalk.yellow(unusedFunctions.length)}`);
  }
  
  // Disclaimer
  console.log(chalk.gray('\n⚠️  Note: Some "unused" code may be used dynamically or in entry points.'));
  console.log(chalk.gray('   Review before deleting. Run with --exports-only for higher confidence.\n'));
  
  // Output to file
  if (opts.output) {
    const report = {
      timestamp: new Date().toISOString(),
      filesScanned: files.length,
      totalExports,
      totalFunctions: opts.exportsOnly ? null : totalFunctions,
      unusedExports: unusedExports.map(e => ({
        name: e.name,
        type: e.type,
        file: path.relative(opts.dir, e.file),
      })),
      unusedFunctions: opts.exportsOnly ? null : unusedFunctions.map(f => ({
        name: f.name,
        type: f.type,
        file: path.relative(opts.dir, f.file),
      })),
    };
    fs.writeFileSync(opts.output, JSON.stringify(report, null, 2));
    console.log(chalk.green(`Report saved to ${opts.output}\n`));
  }
}

main().catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});

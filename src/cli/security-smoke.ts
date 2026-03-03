import * as fs from 'fs';
import * as path from 'path';

export interface SecuritySmokeFinding {
  filePath: string;
  line: number;
  col: number;
  severity: 'error' | 'warning';
  message: string;
}

interface SecurityPattern {
  severity: SecuritySmokeFinding['severity'];
  regex: RegExp;
  message: string;
}

interface HtmlAttribute {
  name: string;
  value: string | null;
  index: number;
}

interface HtmlStartTag {
  tagName: string;
  attrs: HtmlAttribute[];
}

const INLINE_EVENT_HANDLER_MESSAGE =
  'Inline event handler found in template. Use d-on-* instead.';
const JAVASCRIPT_URL_MESSAGE =
  'Executable javascript: URL found in template sink.';
const EXECUTABLE_DATA_URL_MESSAGE =
  'Executable data: URL found in template sink.';
const DANGEROUS_URL_PROTOCOL_MESSAGE =
  'Dangerous URL protocol found in template sink.';
const SRCDOC_WARNING_MESSAGE =
  'srcdoc embeds raw HTML. Review this iframe content as trusted-only.';
const D_HTML_WARNING_MESSAGE =
  'd-html renders raw HTML. Keep the source trusted or sanitized.';
const D_ATTR_SRCDOC_WARNING_MESSAGE =
  'd-attr-srcdoc writes raw iframe markup. Review the source as trusted-only.';

const HTML_INLINE_HANDLER_ATTR_NAMES = new Set([
  'onabort',
  'onafterprint',
  'onanimationcancel',
  'onanimationend',
  'onanimationiteration',
  'onanimationstart',
  'onauxclick',
  'onbeforeinput',
  'onbeforematch',
  'onbeforeprint',
  'onbeforetoggle',
  'onbeforeunload',
  'onbegin',
  'onblur',
  'oncancel',
  'oncanplay',
  'oncanplaythrough',
  'onchange',
  'onclick',
  'onclose',
  'oncontextlost',
  'oncontextmenu',
  'oncontextrestored',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'ondurationchange',
  'onemptied',
  'onend',
  'onended',
  'onerror',
  'onfocus',
  'onformdata',
  'onfullscreenchange',
  'onfullscreenerror',
  'ongotpointercapture',
  'onhashchange',
  'oninput',
  'oninvalid',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onlanguagechange',
  'onload',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onlostpointercapture',
  'onmessage',
  'onmessageerror',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onoffline',
  'ononline',
  'onpagehide',
  'onpageshow',
  'onpaste',
  'onpause',
  'onplay',
  'onplaying',
  'onpointercancel',
  'onpointerdown',
  'onpointerenter',
  'onpointerleave',
  'onpointermove',
  'onpointerout',
  'onpointerover',
  'onpointerrawupdate',
  'onpointerup',
  'onpopstate',
  'onprogress',
  'onratechange',
  'onrepeat',
  'onreset',
  'onresize',
  'onscroll',
  'onscrollend',
  'onsecuritypolicyviolation',
  'onseeked',
  'onseeking',
  'onselect',
  'onselectionchange',
  'onselectstart',
  'onslotchange',
  'onstalled',
  'onstorage',
  'onsubmit',
  'onsuspend',
  'ontimeupdate',
  'ontoggle',
  'ontransitioncancel',
  'ontransitionend',
  'ontransitionrun',
  'ontransitionstart',
  'onunhandledrejection',
  'onunload',
  'onvolumechange',
  'onwaiting',
  'onwebkitanimationend',
  'onwebkitanimationiteration',
  'onwebkitanimationstart',
  'onwebkittransitionend',
  'onwheel',
]);

const HTML_URL_ATTR_NAMES = new Set([
  'href',
  'src',
  'xlink:href',
  'formaction',
  'action',
  'poster',
  'data',
]);

const SAFE_URL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
  'blob:',
]);

const EXECUTABLE_DATA_URL_PATTERN =
  /^data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)\b/i;

const SOURCE_SECURITY_PATTERNS: SecurityPattern[] = [
  {
    severity: 'warning',
    regex: /\b(?:innerHTML|outerHTML)\s*=/g,
    message: 'Raw HTML sink assignment found in source. Review the input as trusted-only.',
  },
  {
    severity: 'warning',
    regex: /\binsertAdjacentHTML\s*\(/g,
    message: 'insertAdjacentHTML() found in source. Review the inserted markup as trusted-only.',
  },
  {
    severity: 'warning',
    regex: /\bdocument\.write\s*\(/g,
    message: 'document.write() found in source. Review the written markup as trusted-only.',
  },
  {
    severity: 'warning',
    regex: /\bfromHtml\s*\(/g,
    message: 'fromHtml() found in source. Pass only trusted template markup.',
  },
];

function findProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    if (
      fs.existsSync(path.join(current, 'package.json'))
      || fs.existsSync(path.join(current, 'tsconfig.json'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findExistingAncestor(startPath: string): string {
  let current = path.resolve(startPath);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }

  return current;
}

function resolveSecuritySmokeScope(scanPath: string): {
  projectRoot: string;
  scanRoot: string;
} {
  const resolvedPath = path.resolve(scanPath);
  const existingPath = findExistingAncestor(resolvedPath);
  const startDir = fs.statSync(existingPath).isDirectory()
    ? existingPath
    : path.dirname(existingPath);
  const projectRoot = findProjectRoot(startDir) ?? startDir;
  return {
    projectRoot,
    scanRoot: resolvedPath,
  };
}

function collectCandidateFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;

  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    const ext = path.extname(dir).toLowerCase();
    if (ext === '.html' || ext === '.ts' || ext === '.js') {
      files.push(dir);
    }
    return files;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCandidateFiles(fullPath, files);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (ext === '.html' || ext === '.ts' || ext === '.js') {
      files.push(fullPath);
    }
  }

  return files;
}

function getLineCol(source: string, offset: number): { line: number; col: number } {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return {
    line: lines.length,
    col: lines[lines.length - 1].length + 1,
  };
}

function isHtmlTagStartChar(char: string | undefined): boolean {
  return !!char && /[a-zA-Z]/.test(char);
}

function collectHtmlStartTags(source: string): HtmlStartTag[] {
  const tags: HtmlStartTag[] = [];
  let i = 0;

  while (i < source.length) {
    if (source[i] !== '<') {
      i += 1;
      continue;
    }

    const next = source[i + 1];
    if (next === '/' || next === '!' || next === '?' || !isHtmlTagStartChar(next)) {
      i += 1;
      continue;
    }

    i += 1;
    const tagNameStart = i;
    while (i < source.length && /[\w:-]/.test(source[i])) {
      i += 1;
    }

    const tagName = source.slice(tagNameStart, i);
    if (!tagName) {
      i += 1;
      continue;
    }

    const attrs: HtmlAttribute[] = [];
    let closed = false;

    while (i < source.length) {
      while (i < source.length && /\s/.test(source[i])) {
        i += 1;
      }

      if (i >= source.length) break;
      if (source[i] === '>') {
        i += 1;
        closed = true;
        break;
      }
      if (source[i] === '/' && source[i + 1] === '>') {
        i += 2;
        closed = true;
        break;
      }
      if (source[i] === '/') {
        i += 1;
        continue;
      }

      const attrStart = i;
      while (i < source.length && !/[\s=/>]/.test(source[i])) {
        i += 1;
      }

      if (i === attrStart) {
        i += 1;
        continue;
      }

      const name = source.slice(attrStart, i);
      while (i < source.length && /\s/.test(source[i])) {
        i += 1;
      }

      let value: string | null = null;
      if (source[i] === '=') {
        i += 1;
        while (i < source.length && /\s/.test(source[i])) {
          i += 1;
        }

        if (i >= source.length) break;

        const quote = source[i];
        if (quote === '"' || quote === "'") {
          i += 1;
          const valueStart = i;
          while (i < source.length && source[i] !== quote) {
            i += 1;
          }
          value = source.slice(valueStart, i);
          if (i < source.length) {
            i += 1;
          }
        } else {
          const valueStart = i;
          while (i < source.length && !/[\s>]/.test(source[i])) {
            i += 1;
          }
          value = source.slice(valueStart, i);
        }
      }

      attrs.push({ name, value, index: attrStart });
    }

    if (closed) {
      tags.push({ tagName, attrs });
    }
  }

  return tags;
}

function normalizeProtocolCheckValue(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
}

function extractUrlProtocol(value: string): string | null {
  const match = value.match(/^([a-z][a-z0-9+\-.]*):/i);
  return match ? `${match[1].toLowerCase()}:` : null;
}

function classifyDangerousHtmlUrl(
  tagName: string,
  attrName: string,
  value: string | null
): string | null {
  const normalizedAttrName = attrName.toLowerCase();
  if (!HTML_URL_ATTR_NAMES.has(normalizedAttrName)) return null;
  if (normalizedAttrName === 'data' && tagName.toLowerCase() !== 'object') {
    return null;
  }
  if (value == null) return null;

  const normalized = normalizeProtocolCheckValue(value);
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.startsWith('./')
    || normalized.startsWith('../')
    || normalized.startsWith('?')
    || normalized.startsWith('#')
  ) {
    return null;
  }

  const protocol = extractUrlProtocol(normalized);
  if (!protocol) return null;
  if (protocol === 'javascript:') return JAVASCRIPT_URL_MESSAGE;
  if (EXECUTABLE_DATA_URL_PATTERN.test(normalized)) return EXECUTABLE_DATA_URL_MESSAGE;
  if (!SAFE_URL_PROTOCOLS.has(protocol)) return DANGEROUS_URL_PROTOCOL_MESSAGE;
  return null;
}

function collectHtmlTemplateFindings(
  source: string,
  filePath: string,
  findings: SecuritySmokeFinding[]
): void {
  for (const tag of collectHtmlStartTags(source)) {
    for (const attr of tag.attrs) {
      const attrName = attr.name.toLowerCase();
      const { line, col } = getLineCol(source, attr.index);

      if (HTML_INLINE_HANDLER_ATTR_NAMES.has(attrName)) {
        findings.push({
          filePath,
          line,
          col,
          severity: 'error',
          message: INLINE_EVENT_HANDLER_MESSAGE,
        });
      }

      const dangerousUrlMessage = classifyDangerousHtmlUrl(tag.tagName, attrName, attr.value);
      if (dangerousUrlMessage) {
        findings.push({
          filePath,
          line,
          col,
          severity: 'error',
          message: dangerousUrlMessage,
        });
      }

      if (attrName === 'srcdoc') {
        findings.push({
          filePath,
          line,
          col,
          severity: 'warning',
          message: SRCDOC_WARNING_MESSAGE,
        });
      }

      if (attrName === 'd-html') {
        findings.push({
          filePath,
          line,
          col,
          severity: 'warning',
          message: D_HTML_WARNING_MESSAGE,
        });
      }

      if (attrName === 'd-attr-srcdoc') {
        findings.push({
          filePath,
          line,
          col,
          severity: 'warning',
          message: D_ATTR_SRCDOC_WARNING_MESSAGE,
        });
      }
    }
  }
}

function collectPatternFindings(
  source: string,
  filePath: string,
  patterns: SecurityPattern[],
  findings: SecuritySmokeFinding[]
): void {
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null = null;
    while ((match = pattern.regex.exec(source)) !== null) {
      const { line, col } = getLineCol(source, match.index);
      findings.push({
        filePath,
        line,
        col,
        severity: pattern.severity,
        message: pattern.message,
      });

      if (match[0].length === 0) {
        pattern.regex.lastIndex += 1;
      }
    }
  }
}

export async function runSecuritySmokeChecks(scanPath: string): Promise<number> {
  const { projectRoot, scanRoot } = resolveSecuritySmokeScope(scanPath);
  if (!fs.existsSync(scanRoot)) {
    return 1;
  }

  const findings: SecuritySmokeFinding[] = [];
  const files = collectCandidateFiles(scanRoot);

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.html') {
      collectHtmlTemplateFindings(source, filePath, findings);
      continue;
    }

    collectPatternFindings(source, filePath, SOURCE_SECURITY_PATTERNS, findings);
  }

  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');

  console.log('🛡 Dalila Security Smoke');

  if (findings.length === 0) {
    console.log('✅ No dangerous template patterns found');
    console.log('');
    return 0;
  }

  const grouped = new Map<string, SecuritySmokeFinding[]>();
  for (const finding of findings) {
    const bucket = grouped.get(finding.filePath) ?? [];
    bucket.push(finding);
    grouped.set(finding.filePath, bucket);
  }

  for (const [filePath, bucket] of grouped) {
    console.log(`  ${path.relative(projectRoot, filePath)}`);
    for (const finding of bucket) {
      const prefix = finding.severity === 'error' ? '❌' : '⚠️';
      console.log(`    ${`${finding.line}:${finding.col}`.padEnd(8)} ${prefix} ${finding.message}`);
    }
    console.log('');
  }

  const summaryParts: string[] = [];
  if (errors.length > 0) {
    summaryParts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}`);
  }
  if (warnings.length > 0) {
    summaryParts.push(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  }

  const summary = summaryParts.join(' and ');
  if (errors.length > 0) {
    console.log(`❌ Security smoke found ${summary}`);
    console.log('');
    return 1;
  }

  console.log(`⚠️ Security smoke found ${summary}`);
  console.log('');
  return 0;
}

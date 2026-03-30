import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import * as XLSX from 'xlsx';

const DEFAULT_IGNORE_RULES: string[] = [
    // 版本控制系统
    '.git/',
    '.svn/',
    '.hg/',
    '.bzr/',

    // 依赖包目录
    'node_modules/',
    'vendor/',
    'bower_components/',
    'jspm_packages/',
    'packages/',
    'target/',          // Maven/Gradle 构建输出
    'build/',
    'dist/',
    'out/',
    'bin/',
    'obj/',
    'lib/',
    'site-packages/',   // Python
    'env/',             // Python 虚拟环境常见名称
    '.venv/',
    'venv/',
    '__pycache__/',

    // IDE 配置目录
    '.idea/',
    '.vscode/',
    '.vs/',
    '.eclipse/',
    '.settings/',
    '.project',
    '.classpath',
    '.metadata/',
    '.gradle/',

    // 构建产物/临时文件
    'coverage/',
    '.nyc_output/',
    '.cache/',
    'tmp/',
    'temp/',
    'logs/',
    'cmake-build-debug/',

    // 操作系统生成文件
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '.Spotlight-V100',
    '.Trashes',

    // 常见框架/工具生成目录
    '.next/',
    '.nuxt/',
    '.serverless/',
    '.terraform/',
    '.vagrant/',
    'docker/',
    'vendor/',
    'node_modules/', // 重复但保留以强调
];

const ALL_SUPPORTED_LANGUAGES: { ext: string; lang: string }[] = [
        {ext: 'c', lang: 'C'}, 
        {ext: 'cpp', lang: 'C++'}, 
        {ext: 'h', lang: 'C Header'}, 
        {ext: 'hpp', lang: 'C++ Header'}, 
        {ext: 'py', lang: 'Python'},
        {ext: 'java', lang: 'Java'}
    ];

interface ProgressBarStyle {
    type: 'default' | 'circle' | 'block' | 'simple' | 'custom';
    length: number;
    fillChar: string;
    emptyChar: string;
    showPercentage: boolean;
    showNumbers: boolean;
}

let updateTimer: NodeJS.Timeout | undefined;
let pendingDoc: vscode.TextDocument | null = null;
let ignoreFileDebounceTimer: NodeJS.Timeout | undefined;
let progressBarStyleconfig: ProgressBarStyle;

/**
 * 获取工作区根目录
 * 如果打开的是多根工作区，默认使用第一个文件夹
 */
function getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    return folders[0].uri.fsPath;
}

/**
 * 加载忽略规则
 * 如果存在 .codelinesignore 文
 * 件，则使用该文件内容；
 * 否则返回内置默认规则
 */
function loadIgnoreRules(workspaceRoot: string): string[] {
    const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
    if (fs.existsSync(ignoreFilePath)) {
        const content = fs.readFileSync(ignoreFilePath, 'utf-8');
        // 按行分割，去除空格，忽略空行和注释行
        const rules = content.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        return rules;
    }
    // 没有自定义文件，返回默认规则
    return DEFAULT_IGNORE_RULES;
}

/**
 * 生成默认的 .codelinesignore 文件（可选命令）
 */
async function generateDefaultIgnoreFile(workspaceRoot: string): Promise<void> {
    const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
    if (fs.existsSync(ignoreFilePath)) {
        const overwrite = await vscode.window.showWarningMessage(
            '.codelinesignore 文件已存在，是否覆盖？',
            { modal: false },
            '覆盖', '取消'
        );
        if (overwrite !== '覆盖') {
            return;
        }
    }
    const content = DEFAULT_IGNORE_RULES.join('\n');
    fs.writeFileSync(ignoreFilePath, content, 'utf-8');
    vscode.window.showInformationMessage('.codelinesignore 已生成，请根据需要编辑。');
}

/**
 * 通过扫描当前工作区内的目录，智能生成符合用户项目结构的 .codelinesignore 文件
 * 该功能会分析项目中的文件和目录结构，自动识别常见的构建输出目录、依赖包目录、版本控制系统目录等，并生成相应的忽略规则。
 * 用户可以选择是否覆盖现有的 .codelinesignore 文件。
 * @param context 
 */
async function generateSmartIgnoreFile(workspaceRoot: string): Promise<void> {
    // 1. 基于默认规则检测实际存在的目录/文件
    const newDefaultRules: string[] = [];
    for (const rule of DEFAULT_IGNORE_RULES) {
        // 移除末尾的 '/' 用于文件系统检测（规则可能以 '/' 结尾表示目录）
        const rulePath = path.join(workspaceRoot, rule.replace(/\/$/, ''));
        try {
            if (fs.existsSync(rulePath)) {
                newDefaultRules.push(rule); // 保留原始格式（含 '/'）
            }
        } catch (error) {
            console.warn(`检查路径 ${rule} 失败`, error);
        }
    }

    const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
    let finalRules: string[] = [];

    if (fs.existsSync(ignoreFilePath)) {
        // 2. 读取现有文件，解析规则（去除空行和注释）
        const existingContent = fs.readFileSync(ignoreFilePath, 'utf-8');
        const existingRules = existingContent.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        // 3. 分离用户自定义规则（不在 DEFAULT_IGNORE_RULES 中的规则）
        const defaultSet = new Set(DEFAULT_IGNORE_RULES);
        const userRules = existingRules.filter(rule => !defaultSet.has(rule));

        // 4. 合并规则：用户规则全部保留，新检测到的默认规则去重后加入
        const ruleSet = new Set<string>();
        userRules.forEach(rule => ruleSet.add(rule));
        newDefaultRules.forEach(rule => ruleSet.add(rule));
        finalRules = Array.from(ruleSet);

        // 5. 检查是否有实际变化（忽略顺序）
        const sortedExisting = [...existingRules].sort().join('\n');
        const sortedFinal = [...finalRules].sort().join('\n');
        if (sortedFinal === sortedExisting) {
            vscode.window.showInformationMessage('当前 .codelinesignore 已包含所有检测到的默认规则，无需更新。');
            return;
        }

        // 6. 询问用户是否合并更新
        const answer = await vscode.window.showWarningMessage(
            '检测到已有 .codelinesignore 文件，是否合并更新默认目录规则（保留您的自定义规则）？',
            { modal: false },
            '更新', '取消'
        );
        if (answer !== '更新') {
            vscode.window.showInformationMessage('已取消更新');
            return;
        }
    } else {
        // 7. 文件不存在，直接使用新检测到的默认规则
        finalRules = newDefaultRules;
        if (finalRules.length === 0) {
            vscode.window.showInformationMessage('未检测到需要忽略的常见目录，将生成空文件（可手动添加规则）');
        }
    }

    // 8. 写入文件
    const fileContent = finalRules.join('\n');
    try {
        fs.writeFileSync(ignoreFilePath, fileContent, 'utf-8');
        vscode.window.showInformationMessage(`已成功生成 .codelinesignore (包含 ${finalRules.length} 条规则)`);
    } catch (error) {
        vscode.window.showErrorMessage(`写入文件失败: ${error}`);
    }
}

// 缓存 ignore 实例，避免每次重复加载文件
let cachedIg: ReturnType<typeof ignore> | null = null;
let cachedWorkspaceRoot: string | undefined;
let ignoreEditedDocCache: Map<string, boolean> = new Map(); // 记录正在编辑的文档是否需要忽略，避免重复处理

/**
 * 获取当前工作区的 ignore 实例（基于 .codelinesignore 或默认规则）
 */
function getIgnoreInstance(workspaceRoot: string): ReturnType<typeof ignore> {
    if (cachedIg && cachedWorkspaceRoot === workspaceRoot) {
        return cachedIg;
    }
    const rules = loadIgnoreRules(workspaceRoot);
    cachedIg = ignore().add(rules);
    cachedWorkspaceRoot = workspaceRoot;
    return cachedIg;
}

/**
 * 判断文件是否应被忽略（根据 .codelinesignore）
 */
function shouldIgnoreFile(doc: vscode.TextDocument): boolean {
    const uri = doc.uri.toString();
    if (ignoreEditedDocCache.has(uri)) {
        return ignoreEditedDocCache.get(uri)!;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {return false;}
    //判断该文件是否属于.codelinesignore的忽略范围
    const relativePath = path.relative(workspaceRoot, doc.fileName).replace(/\\/g, '/');
    const ig = getIgnoreInstance(workspaceRoot);
    if(ig.ignores(relativePath)) {
        ignoreEditedDocCache.set(uri, true);
        return true;
    }

    // 判断该文件的扩展名是否属于用户配置中启用的语言
    const config = vscode.workspace.getConfiguration('code-line-counter');
    const langConfig = config.get<{ [key: string]: boolean }>('languages', {});
    const ext = path.extname(doc.fileName).toLowerCase().slice(1);
    if (langConfig[ext]) {
        ignoreEditedDocCache.set(uri, false);
        return false;
    } else {
        ignoreEditedDocCache.set(uri, true);
        return true;
    }
}


const docNonBlankLinesCache = new Map<string, number>();

/**
 * 获取当前日期的字符串表示，用作存储键
 */
function getTodayDateStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * 获取今日已累计的代码行数（从全局状态中读取）
 */
export function getTodayLinesAdded(context: vscode.ExtensionContext): number {
    const key = `linesAdded_${getTodayDateStr()}`;
    return context.globalState.get(key, 0);
}

/**
 * 判断文件扩展名是否属于支持的源代码文件
 */
function isSupportedDocument(doc: vscode.TextDocument): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    return ['.c', '.cpp', '.py', '.java','.h','.hpp'].includes(ext);
}

/**
 * 计算一段文本中非空白行的数量
 */
function countNonBlankLines(text: string): number {
    return text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}

/**
 * 更新今日累计行数（在文档变更事件中调用）
 */
function updateTodayLinesAdded(context: vscode.ExtensionContext, delta: number) {
    const key = `linesAdded_${getTodayDateStr()}`;
    const current = context.globalState.get(key, 0);
    if (current + delta < 0) {
        context.globalState.update(key, 0);
        //todayLinesCache = 0;
        updateProgressBar(context);
        return;
    }
    context.globalState.update(key, current + delta);
    //todayLinesCache = current + delta;
    updateProgressBar(context);
}

/**
 * 更新用户代码总数（自插件第一次激活以来）
 */
function updateUserTotalLines(context: vscode.ExtensionContext, delta: number) {
    const current = context.globalState.get<number>(USER_TOTAL_LINES_KEY, 0);
    if (delta < 0) {
        return;
    }
    context.globalState.update(USER_TOTAL_LINES_KEY, current + delta);
    const has_grand_congrated = context.globalState.get<boolean>(GRAND_CONGRAT_KEY, false);
    if (current + delta > 10000 && !has_grand_congrated){
        vscode.window.showInformationMessage(`Congratulations! You have written 10,000 lines of code!`);
        context.globalState.update(GRAND_CONGRAT_KEY, true);
    }
}

/**
 * 清空今日已累计行数
 */
function resetTodayLines(context: vscode.ExtensionContext) {
    const key = `linesAdded_${getTodayDateStr()}`;
    context.globalState.update(key, 0);
    //todayLinesCache = 0;
    updateProgressBar(context);
}

// 全局状态存储键
const PROGRESS_ENABLED_KEY = 'progressEnabled';
let isProgressEnabled = false;
const DAILY_GOAL_KEY = 'dailyGoal';
const USER_TOTAL_LINES_KEY = 'userTotalLines';
const GRAND_CONGRAT_KEY = 'grandCongrat';

// 状态栏项
let statusBarItem: vscode.StatusBarItem;

function getProgressBarStyle(): ProgressBarStyle {
    const config = vscode.workspace.getConfiguration('code-line-counter');
    const styleConfig = config.get<any>('progressBarStyle', {});
    return {
        type: styleConfig.type ?? 'default',
        length: Math.min(30, Math.max(5, styleConfig.length ?? 10)),
        fillChar: styleConfig.fillChar ?? '█',
        emptyChar: styleConfig.emptyChar ?? '░',
        showPercentage: styleConfig.showPercentage ?? true,
        showNumbers: styleConfig.showNumbers ?? true,
    };
}

function getCelebrationMessage(): string {
    const config = vscode.workspace.getConfiguration('code-line-counter');
    return config.get<string>('celebrationMessage', '🎉 恭喜！今日已编写 {goal} 行代码！ 🎉');
}

function getDebounceTime(): number {
    const config = vscode.workspace.getConfiguration('code-line-counter');
    return config.get<number>('debounceTime', 300);
}

function generateProgressBar(todayLines: number, goal: number, style: ProgressBarStyle): string {
    if (goal <= 0) {return '';}

    const percent = Math.min(100, Math.floor((todayLines / goal) * 100));
    const barLength = style.length;

    let fillChar: string, emptyChar: string;
    switch (style.type) {
        case 'circle':
            fillChar = '⬤';
            emptyChar = '○';
            break;
        case 'block':
            fillChar = '■';
            emptyChar = '□';
            break;
        case 'custom':
            fillChar = style.fillChar;
            emptyChar = style.emptyChar;
            break;
        default:
            fillChar = '█';
            emptyChar = '░';
    }

    let bar = '';
    if (style.type !== 'simple') {
        const filled = Math.floor(percent / (100 / barLength));
        const empty = barLength - filled;
        bar = fillChar.repeat(filled) + emptyChar.repeat(empty);
    }

    const parts: string[] = [];
    if (bar) {parts.push(bar);}
    if (style.showNumbers) {parts.push(`${todayLines}/${goal}`);}
    if (style.showPercentage) {parts.push(`${percent}%`);}

    const icon = '$(pulse)';
    return `${icon} ${parts.join(' ')}`.trim();
}

let todayGoalCache:number | null = null;
let hasCelebratedToday = false;
//let todayLinesCache: number | null = null;

function updateProgressBar(context: vscode.ExtensionContext) {
    if (!statusBarItem) {return;}

    const goal = todayGoalCache!;
    //todayGoalCache在插件激活时要么被初始化为全局状态中的值，要么是零，总归是有值的
    //!== null ? todayGoalCache : context.globalState.get<number>(DAILY_GOAL_KEY, 0);

    if (!isProgressEnabled || goal <= 0) {
        statusBarItem.hide();
        return;
    }

    //const todayLines = todayLinesCache!;
    const todayLines = context.globalState.get(`linesAdded_${getTodayDateStr()}`, 0);
    //同样，todayLinesCache在插件激活时要么被初始化为全局状态中的值，要么是零，总归是有值的
    const barText = generateProgressBar(todayLines, goal, progressBarStyleconfig);

    statusBarItem.text = barText;
    statusBarItem.tooltip = `今日已写 ${todayLines} 行，目标 ${goal} 行`;
    statusBarItem.show();

    if (!hasCelebratedToday && todayLines >= goal) {
        hasCelebratedToday = true;
        const celebratedKey = `celebrated_${getTodayDateStr()}`;
        context.globalState.update(celebratedKey, true);
        const messageTemplate = getCelebrationMessage();
        const message = messageTemplate
            .replace(/\{goal\}/g, goal.toString())
            .replace(/\{lines\}/g, todayLines.toString());
        vscode.window.showInformationMessage(message);
    }
}

/**
 * 重置庆祝标记（每天第一次更新时调用）
 */
function resetDailyGoalIfNeeded(context: vscode.ExtensionContext) {
    const lastCheckDateKey = 'lastCelebratedDate';
    const today = getTodayDateStr();
    const lastDate = context.globalState.get<string>(lastCheckDateKey, '');
    if (lastDate !== today) {
        context.globalState.update(DAILY_GOAL_KEY, 0);
        context.globalState.update(lastCheckDateKey, today);
    }
}

/**
 * 设置今日目标
 */
async function setDailyGoal(context: vscode.ExtensionContext) {
    const input = await vscode.window.showInputBox({
        prompt: '请输入今日代码行目标（整数）',
        validateInput: (value) => {
            if(value === "CLC") {
                vscode.window.showInformationMessage(`[Greetings from CLC v0.0.3]Let's make progress together!`);
                return null;
            }
            const num = parseInt(value);
            if (isNaN(num) || num <= 0) {return '请输入大于0的整数';}
            return null;
        }
    });
    if (!input || input === "CLC") {return;}

    const goal = parseInt(input);
    todayGoalCache = goal;
    await context.globalState.update(DAILY_GOAL_KEY, goal);
    isProgressEnabled = true;
    await context.globalState.update(PROGRESS_ENABLED_KEY, true);
    await context.globalState.update(`celebrated_${getTodayDateStr()}`, false);

    updateProgressBar(context);
    const enabledLanguages:{ext: string, lang: string}[] = get_enabled_languages(context);
    const langNames = enabledLanguages.map(l => l.lang).join('、');
    if (!langNames) {
        vscode.window.showInformationMessage(
            '今日代码目标已设置，进度条已显示。但您好像没有选择任何想要统计的语言，需要修改相关设置吗？',
            '打开设置'
        ).then(Selection => {
            if (Selection === '打开设置'){
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'Extensions:code-line-counter'
                );
            }
        });
    } else {
        vscode.window.showInformationMessage(
            `今日代码目标已设置，进度条已显示。目前统计的语言有${langNames}，您想要修改相关设置吗？`,
            '打开设置'
        ).then(Selection => {
            if (Selection === '打开设置'){
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'Extensions:code-line-counter'
                );
            }
        });
    }
}

/**
 * 切换进度条显示
 */
async function switchProgressBar(context: vscode.ExtensionContext) {
    isProgressEnabled = !isProgressEnabled;
    await context.globalState.update(PROGRESS_ENABLED_KEY, isProgressEnabled);
    updateProgressBar(context);
    vscode.window.showInformationMessage(`进度条已${!isProgressEnabled ? '显示' : '隐藏'}`);
}

function get_enabled_languages(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('code-line-counter');
    const langConfig = config.get<{ [key: string]: boolean }>('languages', {});
    const enabledLanguages: { ext: string; lang: string }[] = [];

    if (langConfig.c) {enabledLanguages.push({ ext: 'c', lang: 'C' });}
    if (langConfig.cpp) {enabledLanguages.push({ ext: 'cpp', lang: 'C++' });}
    if (langConfig.h) {enabledLanguages.push({ ext: 'h', lang: 'C Header' });}
    if (langConfig.hpp) {enabledLanguages.push({ ext: 'hpp', lang: 'C++ Header' });}
    if (langConfig.py) {enabledLanguages.push({ ext: 'py', lang: 'Python' });}
    if (langConfig.java) {enabledLanguages.push({ ext: 'java', lang: 'Java' });}

    return enabledLanguages;
}

interface WorkspaceStats {
    langStats: { [lang: string]: { files: number; totalLines: number; codeLines: number; commentLines: number; blankLines: number } };
    totalStats: { files: number; totalLines: number; codeLines: number; commentLines: number; blankLines: number };
    fileDetails: any[];
}

async function collectWorkspaceStats(context: vscode.ExtensionContext): Promise<WorkspaceStats | undefined> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return undefined;
    }

    const enabledLanguages = get_enabled_languages(context);
    if (enabledLanguages.length === 0) {
        vscode.window.showErrorMessage('请在设置中启用至少一种语言');
        return undefined;
    }

    const extPattern = enabledLanguages.map(l => l.ext).join(',');
    const pattern = `**/*.{${extPattern}}`;
    const files = await vscode.workspace.findFiles(pattern);
    if (files.length === 0) {
        vscode.window.showErrorMessage('未找到任何符合条件的文件');
        return undefined;
    }

    const rules = loadIgnoreRules(workspaceRoot);
    const ig = ignore().add(rules);

    const filteredFiles = files.filter(file => {
        const absolutePath = file.fsPath;
        const relativePath = path.relative(workspaceRoot, absolutePath);
        const posixPath = relativePath.replace(/\\/g, '/');
        return !ig.ignores(posixPath);
    });

    if (filteredFiles.length === 0) {
        vscode.window.showErrorMessage('所有文件均被忽略规则排除');
        return undefined;
    }

    const langStats: { [lang: string]: any } = {};
    for (const lang of enabledLanguages) {
        langStats[lang.lang] = { files: 0, totalLines: 0, codeLines: 0, commentLines: 0, blankLines: 0 };
    }
    let totalStats = { files: 0, totalLines: 0, codeLines: 0, commentLines: 0, blankLines: 0 };
    const fileDetails: any[] = [];

    // 并发读取文件
    const filePromises = filteredFiles.map(async (file) => {
        const filePath = file.fsPath;
        const ext = path.extname(filePath).toLowerCase().slice(1);
        const langEntry = enabledLanguages.find(l => l.ext === ext);
        if (!langEntry) {return null;}

        try {
            const uint8Array = await vscode.workspace.fs.readFile(file);
            const content = new TextDecoder('utf-8').decode(uint8Array);
            const stats = analyzeFile(content, `.${ext}`);
            return {
                lang: langEntry.lang,
                stats,
                relativePath: path.relative(workspaceRoot, filePath)
            };
        } catch (err) {
            console.error(`读取文件失败: ${filePath}`, err);
            return null;
        }
    });

    const results = await Promise.all(filePromises);

    // 聚合结果
    for (const result of results) {
        if (!result) {continue;}
        const { lang, stats, relativePath } = result;

        langStats[lang].files++;
        langStats[lang].totalLines += stats.totalLines;
        langStats[lang].codeLines += stats.codeLines;
        langStats[lang].commentLines += stats.commentLines;
        langStats[lang].blankLines += stats.blankLines;

        totalStats.files++;
        totalStats.totalLines += stats.totalLines;
        totalStats.codeLines += stats.codeLines;
        totalStats.commentLines += stats.commentLines;
        totalStats.blankLines += stats.blankLines;

        fileDetails.push({
            '文件路径': relativePath,
            '语言': lang,
            '总行数': stats.totalLines,
            '代码行': stats.codeLines,
            '注释行': stats.commentLines,
            '空行': stats.blankLines
        });
    }

    return { langStats, totalStats, fileDetails };
}

async function exportToExcel(context: vscode.ExtensionContext) {
    const stats = await collectWorkspaceStats(context);
    if (!stats) {return;}

    const { langStats, totalStats, fileDetails } = stats;

    const workbook = XLSX.utils.book_new();

    // 语言统计汇总
    const langSummaryData: any[] = [['语言', '文件数', '总行数', '代码行', '注释行', '空行']];
    for (const [lang, s] of Object.entries(langStats)) {
        if (s.files === 0) {continue;}
        langSummaryData.push([lang, s.files, s.totalLines, s.codeLines, s.commentLines, s.blankLines]);
    }
    langSummaryData.push(['总计', totalStats.files, totalStats.totalLines, totalStats.codeLines, totalStats.commentLines, totalStats.blankLines]);
    const langSheet = XLSX.utils.aoa_to_sheet(langSummaryData);
    XLSX.utils.book_append_sheet(workbook, langSheet, '语言统计');

    // 文件详情
    if (fileDetails.length > 0) {
        const fileSheet = XLSX.utils.json_to_sheet(fileDetails);
        XLSX.utils.book_append_sheet(workbook, fileSheet, '文件详情');
    }

    const workspaceRoot = getWorkspaceRoot()!;
    const defaultFileName = `code-line-stats-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(workspaceRoot, defaultFileName)),
        filters: { 'Excel 文件': ['xlsx'] }
    });
    if (!uri) {return;}

    try {
        const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(`统计结果已导出到 ${path.basename(uri.fsPath)}`);
    } catch (err) {
        vscode.window.showErrorMessage(`导出失败: ${err}`);
    }
}

/**
 * 导出统计结果到markdown文件
 * @param context 
 */
async function exportToMarkdown(context: vscode.ExtensionContext) {
    const stats = await collectWorkspaceStats(context);
    if (!stats) {return;}

    const { langStats, totalStats, fileDetails } = stats;
    const workspaceRoot = getWorkspaceRoot()!;

    // 构建 Markdown 内容
    let markdown = `# Code Line Counter 统计报告\n\n`;
    markdown += `生成时间：${new Date().toLocaleString()}\n\n`;

    // 按语言统计表格
    markdown += `## 按语言统计\n\n`;
    markdown += `| 语言 | 文件数 | 总行数 | 代码行 | 注释行 | 空行 |\n`;
    markdown += `|------|--------|--------|--------|--------|------|\n`;
    for (const [lang, s] of Object.entries(langStats)) {
        if (s.files === 0) {continue;}
        markdown += `| ${lang} | ${s.files} | ${s.totalLines} | ${s.codeLines} | ${s.commentLines} | ${s.blankLines} |\n`;
    }
    // 总计行
    markdown += `| **总计** | **${totalStats.files}** | **${totalStats.totalLines}** | **${totalStats.codeLines}** | **${totalStats.commentLines}** | **${totalStats.blankLines}** |\n\n`;

    // 文件详情表格
    markdown += `## 文件详情\n\n`;
    markdown += `| 文件路径 | 语言 | 总行数 | 代码行 | 注释行 | 空行 |\n`;
    markdown += `|----------|------|--------|--------|--------|------|\n`;
    for (const detail of fileDetails) {
        markdown += `| ${detail['文件路径']} | ${detail['语言']} | ${detail['总行数']} | ${detail['代码行']} | ${detail['注释行']} | ${detail['空行']} |\n`;
    }

    // 选择保存路径
    const defaultFileName = `code-line-stats-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.md`;
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(workspaceRoot, defaultFileName)),
        filters: { 'Markdown 文件': ['md'] }
    });
    if (!uri) {return;}

    try {
        const buffer = Buffer.from(markdown, 'utf-8');
        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(`统计结果已导出到 ${path.basename(uri.fsPath)}`);
    } catch (err) {
        vscode.window.showErrorMessage(`导出失败: ${err}`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const first_time_activate = context.globalState.get<boolean>('never_been_activated', true);
    if (first_time_activate) {
        console.log('Justinian of Code-Line-Counter says Hello!');
        context.globalState.update('never_been_activated',false);
    }

    resetDailyGoalIfNeeded(context);
    progressBarStyleconfig = getProgressBarStyle();
    isProgressEnabled = context.globalState.get<boolean>(PROGRESS_ENABLED_KEY, false);
    todayGoalCache = context.globalState.get<number>(DAILY_GOAL_KEY, 0);
    hasCelebratedToday = context.globalState.get<boolean>(`celebrated_${getTodayDateStr()}`, false);
    //const TodayLinesKey = `linesAdded_${getTodayDateStr()}`;
    //todayLinesCache = context.globalState.get<number>(TodayLinesKey, 0);
    let debounceTime = getDebounceTime();

	const disposableAnalyzeFile = vscode.commands.registerCommand(
		'code-line-counter.analyzeCurrentFile',
		() => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage("请先打开一个文件");
				return;
			}

			const document = editor.document;
            if (!isSupportedDocument(document)) {
                vscode.window.showErrorMessage(`这并非CLC能够统计的源代码文件`);
                return;
            }

			const content = document.getText();
			const filePath = document.fileName;
			const ext = path.extname(filePath).toLowerCase();
			const stats = analyzeFile(content,ext);

			vscode.window.showInformationMessage(
				`文件：${path.basename(filePath)}\n` +
				`总行数：${stats.totalLines}，代码行：${stats.codeLines}` +
				`注释行：${stats.commentLines}，空行：${stats.blankLines}`
			);

		});

	context.subscriptions.push(disposableAnalyzeFile);

        const disposableAnalyzeWorkspace = vscode.commands.registerCommand(
        'code-line-counter.analyzeWorkspace',
        async () => {
            // 1. 检查工作区
            const workspaceRoot = getWorkspaceRoot();
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }

            // 2. 获取用户配置的语言
            const enabledLanguages: { ext: string; lang: string }[] = get_enabled_languages(context);
            if (enabledLanguages.length === 0) {
                vscode.window.showErrorMessage('请在设置中启用至少一种您想要CLC分析的语言');
                return;
            }

            // 3. 动态构建文件搜索模式
            const extPattern = enabledLanguages.map(l => l.ext).join(',');
            const pattern = `**/*.{${extPattern}}`;

            // 4. 创建输出通道
            const outputChannel = vscode.window.createOutputChannel('Code Line Counter');
            outputChannel.clear();
            outputChannel.appendLine(`工作区根目录: ${workspaceRoot}`);

            // 5. 智能处理忽略文件（提示生成或更新）
            const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
            const hasIgnoreFile = fs.existsSync(ignoreFilePath);

            if (!hasIgnoreFile) {
                const answer = await vscode.window.showInformationMessage(
                    '未找到 .codelinesignore 忽略文件，是否基于当前项目生成一个？',
                    '生成', '暂不生成'
                );
                if (answer === '生成') {
                    await generateSmartIgnoreFile(workspaceRoot);
                    outputChannel.appendLine('已生成 .codelinesignore 文件。');
                }
            } else {
                const currentRules = loadIgnoreRules(workspaceRoot);
                const existingDirRules = currentRules.filter(r => r.endsWith('/'));

                const existingDirs: string[] = [];
                for (const dir of DEFAULT_IGNORE_RULES.filter(r => r.endsWith('/'))) {
                    const dirPath = path.join(workspaceRoot, dir.replace(/\/$/, ''));
                    if (fs.existsSync(dirPath)) {
                        existingDirs.push(dir);
                    }
                }

                const missingDirs = existingDirs.filter(dir => !existingDirRules.includes(dir));
                if (missingDirs.length > 0) {
                    const displayDirs = missingDirs.slice(0, 3).join(', ') + (missingDirs.length > 3 ? '等' : '');
                    const answer = await vscode.window.showInformationMessage(
                        `检测到项目中存在可能需要忽略的新目录：${displayDirs}，是否将这些目录添加到 .codelinesignore 中？`,
                        '添加规则', '暂不添加'
                    );
                    if (answer === '添加规则') {
                        const content = fs.readFileSync(ignoreFilePath, 'utf-8');
                        const newContent = content + (content.endsWith('\n') ? '' : '\n') + missingDirs.join('\n');
                        fs.writeFileSync(ignoreFilePath, newContent, 'utf-8');
                        vscode.window.showInformationMessage(`已添加 ${missingDirs.length} 条新规则到 .codelinesignore`);
                        outputChannel.appendLine(`已追加 ${missingDirs.length} 条新忽略规则。`);
                    }
                }
            }

            // 6. 收集统计数据（复用 collectWorkspaceStats）
            const stats = await collectWorkspaceStats(context);
            if (!stats) {
                outputChannel.appendLine('统计失败，请检查控制台。');
                outputChannel.show();
                return;
            }

            const { langStats, totalStats, fileDetails } = stats;

            // 7. 输出每个文件的详细统计
            outputChannel.appendLine(`找到 ${fileDetails.length} 个文件，忽略后剩余 ${fileDetails.length} 个`);
            outputChannel.appendLine(`---------------`);
            for (const detail of fileDetails) {
                outputChannel.appendLine(`${detail['文件路径']}:`);
                outputChannel.appendLine(`  总行数: ${detail['总行数']}`);
                outputChannel.appendLine(`  代码行: ${detail['代码行']}`);
                outputChannel.appendLine(`  注释行: ${detail['注释行']}`);
                outputChannel.appendLine(`  空行: ${detail['空行']}\n`);
            }

            // 8. 输出按语言统计
            outputChannel.appendLine('========== 按语言统计 ==========');
            for (const [lang, s] of Object.entries(langStats)) {
                if (s.files === 0) {continue;}
                outputChannel.appendLine(`${lang}:`);
                outputChannel.appendLine(`  文件数: ${s.files}`);
                outputChannel.appendLine(`  总行数: ${s.totalLines}`);
                outputChannel.appendLine(`  代码行: ${s.codeLines}`);
                outputChannel.appendLine(`  注释行: ${s.commentLines}`);
                outputChannel.appendLine(`  空行: ${s.blankLines}\n`);
            }

            // 9. 输出总计
            outputChannel.appendLine('========== 总计 ==========');
            outputChannel.appendLine(`文件数: ${totalStats.files}`);
            outputChannel.appendLine(`总行数: ${totalStats.totalLines}`);
            outputChannel.appendLine(`代码行: ${totalStats.codeLines}`);
            outputChannel.appendLine(`注释行: ${totalStats.commentLines}`);
            outputChannel.appendLine(`空行: ${totalStats.blankLines}`);

            outputChannel.show();
        }
    );

    // 可选命令：生成默认 .codelinesignore 文件
    const disposableGenerateIgnore = vscode.commands.registerCommand(
        'code-line-counter.generateIgnoreFile',
        async () => {
            const workspaceRoot = getWorkspaceRoot();
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }
            await generateDefaultIgnoreFile(workspaceRoot);
        }
    );

    context.subscriptions.push(disposableAnalyzeWorkspace);
    context.subscriptions.push(disposableGenerateIgnore);

    // 可选命令：通过扫描智能生成 .codelinesignore 文件
    const disposableSmartGenerateIgnore = vscode.commands.registerCommand(
        'code-line-counter.generateSmartIgnoreFile',
        async () => {
            const workspaceRoot = getWorkspaceRoot();
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }
            await generateSmartIgnoreFile(workspaceRoot);
        }
    );

    context.subscriptions.push(disposableSmartGenerateIgnore);

    const IgWatcher = vscode.workspace.createFileSystemWatcher('**/.codelinesignore');
    IgWatcher.onDidChange(() => {
        // 清除之前的定时器
        if (ignoreFileDebounceTimer) {clearTimeout(ignoreFileDebounceTimer);}
        // 延迟后清除缓存
        ignoreFileDebounceTimer = setTimeout(() => {
            cachedIg = null;
            ignoreFileDebounceTimer = undefined;
            ignoreEditedDocCache.clear();
        }, 300);
    });
    context.subscriptions.push(IgWatcher);

    vscode.workspace.textDocuments.forEach(doc => {
        if (isSupportedDocument(doc)) {
            const uri = doc.uri.toString();
            const current = countNonBlankLines(doc.getText());
            docNonBlankLinesCache.set(uri, current);
        }
    });

    const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
        if (debounceTime < 100) {return;}
        const doc = event.document;
        if (!isSupportedDocument(doc)) {return;}

        // 清除之前的定时器，重新计时
        if (updateTimer) {clearTimeout(updateTimer);}
        pendingDoc = doc;
        updateTimer = setTimeout(() => {
            if (pendingDoc) {
                const uri = pendingDoc.uri.toString();
                const current = countNonBlankLines(pendingDoc.getText());
                const prev = docNonBlankLinesCache.get(uri);
                if (prev !== undefined) {
                    const delta = current - prev;
                    docNonBlankLinesCache.set(uri, current);
                    if (!shouldIgnoreFile(pendingDoc)) {
                        updateTodayLinesAdded(context, delta);
                        updateUserTotalLines(context, delta);
                    }
                } else {
                    console.warn(`缓存缺失：${uri}，已设置当前行数，但本次编辑不计入统计。`);
                    docNonBlankLinesCache.set(uri, current);
                }
                updateTimer = undefined;
                pendingDoc = null;
            }
        }, debounceTime);
    });
    context.subscriptions.push(changeListener);

    // 监听打开的文档
    const openListener = vscode.workspace.onDidOpenTextDocument(doc => {
        if (!isSupportedDocument(doc)) {return;}

        const uri = doc.uri.toString();
        const current = countNonBlankLines(doc.getText());
        const prev = docNonBlankLinesCache.get(uri);
        if (prev === undefined){
            docNonBlankLinesCache.set(uri, current);
        }
    });
    context.subscriptions.push(openListener);

    // 监听关闭
    const closeListener = vscode.workspace.onDidCloseTextDocument(doc => {
        if (pendingDoc === doc) {
            // 如果文档正在等待更新，立即取消
            if (updateTimer) {clearTimeout(updateTimer);}
            updateTimer = undefined;
            pendingDoc = null;
        }
        docNonBlankLinesCache.delete(doc.uri.toString());
    });
    context.subscriptions.push(closeListener);

    // 状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    const showTotalCommand = vscode.commands.registerCommand('code-line-counter.showTotalLines',() =>{
        const total = context.globalState.get<number>(USER_TOTAL_LINES_KEY, 0);
        vscode.window.showInformationMessage(`自安装插件以来，已经撰写了${total}行代码`);
    });
    context.subscriptions.push(showTotalCommand);

    // 可选：注册一个命令，让用户可以查看今日代码量
    const showCommand = vscode.commands.registerCommand('code-line-counter.showTodayLines', () => {
        const lines = getTodayLinesAdded(context);
        vscode.window.showInformationMessage(`今日已写 ${lines} 行代码`);
    });
    context.subscriptions.push(showCommand);

    // 注册设置目标命令
    const setGoalCmd = vscode.commands.registerCommand('code-line-counter.setDailyGoal', () => {
        setDailyGoal(context);
    });
    context.subscriptions.push(setGoalCmd);

    // 注册切换进度条命令
    const switchProgressCmd = vscode.commands.registerCommand('code-line-counter.switchProgressBar', () => {
        switchProgressBar(context);
    });
    context.subscriptions.push(switchProgressCmd);

    // 监听配置变化，实时更新进度条样式和庆祝消息
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('code-line-counter.progressBarStyle') ||
            event.affectsConfiguration('code-line-counter.celebrationMessage')) {
            const enabled = context.globalState.get<boolean>(PROGRESS_ENABLED_KEY, false);
            const goal = context.globalState.get<number>(DAILY_GOAL_KEY, 0);
            progressBarStyleconfig = getProgressBarStyle();
            if (enabled && goal > 0) {
                updateProgressBar(context);
            }
        }
    });
    context.subscriptions.push(configChangeListener);

    const debounceChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('code-line-counter.debounceTime')) {
            debounceTime = getDebounceTime();
        }
    });
    context.subscriptions.push(debounceChangeListener);

    // 恢复进度条状态
    const goal = context.globalState.get<number>(DAILY_GOAL_KEY, 0);
    if (isProgressEnabled && goal > 0) {
        updateProgressBar(context);
    } else {
        statusBarItem.hide();
    }

    const exportExcelCmd = vscode.commands.registerCommand('code-line-counter.exportToExcel', () => {
        exportToExcel(context);
    });
    context.subscriptions.push(exportExcelCmd);

    const exportMarkdownCmd = vscode.commands.registerCommand('code-line-counter.exportToMarkdown', () => {
        exportToMarkdown(context);
    });
    context.subscriptions.push(exportMarkdownCmd);

    const resetCmd = vscode.commands.registerCommand('code-line-counter.resetTodayLines', 
        async() => {
        const answer = await vscode.window.showWarningMessage('确定要重置今日累计行数吗？', '重置', '取消');
        if (answer === '重置') {
            resetTodayLines(context);
            vscode.window.showInformationMessage('今日累计行数已重置');
        }
    });
    context.subscriptions.push(resetCmd);
}

function analyzeFile(content: string, ext: string): any {
    const lines = content.split(/\r?\n/);
    let totalLines = lines.length;
    let codeLines = 0;
    let commentLines = 0;
    let blankLines = 0;

    let singleLineComment: string[] = [];
    let multiLineCommentStart: string[] = [];
    let multiLineCommentEnd: string[] = [];

    if (ext === '.c' || ext === '.cpp' || ext === '.java' || ext === '.h' || ext === '.hpp') {
        singleLineComment = ['//'];
        multiLineCommentStart = ['/*'];
        multiLineCommentEnd = ['*/'];
    } else if (ext === '.py') {
        singleLineComment = ['#'];
        multiLineCommentStart = ['"""', "'''"];
        multiLineCommentEnd = ['"""', "'''"];
    }

    let inMultiLineComment = false;
    let idx = 0;

    for (let line of lines) {
        const trimmed = line.trim();

        // 空行
        if (trimmed === '') {
            blankLines++;
            continue;
        }

        // 处理多行注释
        if (!inMultiLineComment) {
            let foundStart = false;
            for (let i = 0; i < multiLineCommentStart.length; i++) {
                const startDelim = multiLineCommentStart[i];
                const endDelim = multiLineCommentEnd[i];
                if (trimmed.startsWith(startDelim)) {
                    const afterStart = trimmed.slice(startDelim.length).trim();
                    idx = i;
                    // 情况1：该行只有开始符（无其他内容）
                    /*
                    if (afterStart === '') {
                        inMultiLineComment = true;
                        currentMultiLineDelimiter = startDelim;
                        foundStart = true;
                        blankLines++;
                        // 计入空白行
                        break;
                    }
                        */
                    // 情况2：开始符后还有其他内容，可能包含结束符
                    if (afterStart.includes(endDelim)) {
                        // 同一行内开始并结束，且包含注释内容，计入注释行
                        commentLines++;
                        foundStart = true;
                        break;
                    } else {
                        // 进入多行注释，当前行有注释内容，计入注释行
                        inMultiLineComment = true;
                        foundStart = true;
                        commentLines++;
                        break;
                    }
                }
            }
            if (foundStart) {continue;}
        } else {
            // 在多行注释中
            const endDelim = multiLineCommentEnd[idx];
            if (trimmed.includes(endDelim)) {
                // 检查该行是否只有结束符
                /*
                const afterEnd = trimmed.replace(endDelim, '').trim();
                if (afterEnd === '') {
                    // 只有结束符，计入空白行
                    inMultiLineComment = false;
                    currentMultiLineDelimiter = '';
                    blankLines++;
                    continue;
                }
                    */
                // 该行有结束符和注释内容（可能在结束符前后）
                commentLines++;
                inMultiLineComment = false;
                continue;
            }
            // 普通注释内容行
            commentLines++;
            continue;
        }

        // 单行注释
        let isComment = false;
        for (const sym of singleLineComment) {
            if (trimmed.startsWith(sym)) {
                isComment = true;
                break;
            }
        }
        if (isComment) {
            commentLines++;
            continue;
        }

        // 其余为代码行
        codeLines++;
    }

    return {
        totalLines,
        codeLines,
        commentLines,
        blankLines
    };
}

// This method is called when your extension is deactivated
export function deactivate(): void {
    if (updateTimer) {clearTimeout(updateTimer);}
    if (ignoreFileDebounceTimer) {clearTimeout(ignoreFileDebounceTimer);}

    docNonBlankLinesCache.clear();
    ignoreEditedDocCache.clear();
}
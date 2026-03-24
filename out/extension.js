"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayLinesAdded = getTodayLinesAdded;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ignore_1 = __importDefault(require("ignore"));
const DEFAULT_IGNORE_RULES = [
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
    'target/', // Maven/Gradle 构建输出
    'build/',
    'dist/',
    'out/',
    'bin/',
    'obj/',
    'lib/',
    'site-packages/', // Python
    'env/', // Python 虚拟环境常见名称
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
/**
 * 获取工作区根目录
 * 如果打开的是多根工作区，默认使用第一个文件夹
 */
function getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    return folders[0].uri.fsPath;
}
/**
 * 加载忽略规则
 * 如果存在 .codelinesignore 文件，则使用该文件内容；
 * 否则返回内置默认规则
 */
function loadIgnoreRules(workspaceRoot) {
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
async function generateDefaultIgnoreFile(workspaceRoot) {
    const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
    if (fs.existsSync(ignoreFilePath)) {
        const overwrite = await vscode.window.showWarningMessage('.codelinesignore 文件已存在，是否覆盖？', { modal: false }, '覆盖', '取消');
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
async function generateSmartIgnoreFile(workspaceRoot) {
    // 1. 基于默认规则检测实际存在的目录/文件
    const newDefaultRules = [];
    for (const rule of DEFAULT_IGNORE_RULES) {
        // 移除末尾的 '/' 用于文件系统检测（规则可能以 '/' 结尾表示目录）
        const rulePath = path.join(workspaceRoot, rule.replace(/\/$/, ''));
        try {
            if (fs.existsSync(rulePath)) {
                newDefaultRules.push(rule); // 保留原始格式（含 '/'）
            }
        }
        catch (error) {
            console.warn(`检查路径 ${rule} 失败`, error);
        }
    }
    const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
    let finalRules = [];
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
        const ruleSet = new Set();
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
        const answer = await vscode.window.showWarningMessage('检测到已有 .codelinesignore 文件，是否合并更新默认目录规则（保留您的自定义规则）？', { modal: false }, '更新', '取消');
        if (answer !== '更新') {
            vscode.window.showInformationMessage('已取消更新');
            return;
        }
    }
    else {
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
    }
    catch (error) {
        vscode.window.showErrorMessage(`写入文件失败: ${error}`);
    }
}
const docNonBlankLinesCache = new Map();
/**
 * 获取当前日期的字符串表示，用作存储键
 */
function getTodayDateStr() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}
/**
 * 获取今日已累计的代码行数（从全局状态中读取）
 */
function getTodayLinesAdded(context) {
    const key = `linesAdded_${getTodayDateStr()}`;
    return context.globalState.get(key, 0);
}
/**
 * 判断文件扩展名是否属于支持的源代码文件
 */
function isSupportedDocument(doc) {
    const ext = path.extname(doc.fileName).toLowerCase();
    return ['.c', '.cpp', '.py', '.java'].includes(ext);
}
/**
 * 计算一段文本中非空白行的数量
 */
function countNonBlankLines(text) {
    return text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}
/**
 * 计算一次文档变更中新增的非空白行数
 * 只有通过换行符增加（即按下回车）产生的新行才会被计入，且新行必须非空。
 */
function countNetNonBlankLinesAdded(event) {
    // 只统计支持的源代码文件
    if (!isSupportedDocument(event.document)) {
        return 0;
    }
    let netAdded = 0;
    for (const change of event.contentChanges) {
        const oldText = event.document.getText(change.range);
        const newText = change.text;
        // 计算变更前后文本的行数（通过换行符拆分）
        const oldLines = oldText.split(/\r?\n/);
        const newLines = newText.split(/\r?\n/);
        const oldLineCount = oldLines.length;
        const newLineCount = newLines.length;
        // 新增的行数（按下回车导致的增加）
        const addedLineCount = newLineCount - oldLineCount;
        if (addedLineCount <= 0) {
            continue;
        }
        // 获取新增的行（新文本的最后 addedLineCount 行）
        const addedLines = newLines.slice(-addedLineCount);
        // 只统计非空行（trim后不为空）
        const nonBlankAdded = addedLines.filter(line => line.trim().length > 0).length;
        netAdded += nonBlankAdded;
    }
    return netAdded;
}
// 缓存 ignore 实例，避免每次重复加载文件
let cachedIg = null;
let cachedWorkspaceRoot;
/**
 * 获取当前工作区的 ignore 实例（基于 .codelinesignore 或默认规则）
 */
function getIgnoreInstance(workspaceRoot) {
    if (cachedIg && cachedWorkspaceRoot === workspaceRoot) {
        return cachedIg;
    }
    const rules = loadIgnoreRules(workspaceRoot); // 复用之前的 loadIgnoreRules
    cachedIg = (0, ignore_1.default)().add(rules);
    cachedWorkspaceRoot = workspaceRoot;
    return cachedIg;
}
/**
 * 判断文件是否应被忽略（根据 .codelinesignore）
 */
function shouldIgnoreFile(doc) {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return false;
    }
    const relativePath = path.relative(workspaceRoot, doc.fileName).replace(/\\/g, '/');
    const ig = getIgnoreInstance(workspaceRoot);
    return ig.ignores(relativePath);
}
/**
 * 更新今日累计行数（增加一个正数）
 */
function updateTodayLinesAdded(context, delta) {
    if (delta <= 0) {
        return;
    }
    const key = `linesAdded_${getTodayDateStr()}`;
    const current = getTodayLinesAdded(context);
    context.globalState.update(key, current + delta);
    updateProgressBar(context);
}
// 全局状态存储键
const PROGRESS_ENABLED_KEY = 'progressEnabled';
const DAILY_GOAL_KEY = 'dailyGoal';
// 状态栏项
let statusBarItem;
// 今日已庆祝标记（避免重复弹窗）
let celebratedToday = false;
/**
 * 更新状态栏进度条
 */
function updateProgressBar(context) {
    if (!statusBarItem) {
        return;
    }
    const enabled = context.globalState.get(PROGRESS_ENABLED_KEY, false);
    const goal = context.globalState.get(DAILY_GOAL_KEY, 0);
    if (!enabled || goal <= 0) {
        statusBarItem.hide();
        return;
    }
    const todayLines = getTodayLinesAdded(context);
    const percent = Math.min(100, Math.floor((todayLines / goal) * 100));
    const barLength = 10;
    const filled = Math.floor(percent / 10);
    const empty = barLength - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    statusBarItem.text = `$(pulse) ${bar} ${todayLines}/${goal} lines (${percent}%)`;
    statusBarItem.tooltip = `今日已写 ${todayLines} 行，目标 ${goal} 行`;
    statusBarItem.show();
    const celebratedKey = `celebrated_${getTodayDateStr()}`;
    const alreadyCelebrated = context.globalState.get(celebratedKey, false);
    if (!alreadyCelebrated && todayLines >= goal) {
        context.globalState.update(celebratedKey, true);
        vscode.window.showInformationMessage(`🎉 恭喜！今日已完成 ${goal} 行代码目标！ 🎉`);
    }
}
/**
 * 重置庆祝标记（每天第一次更新时调用）
 */
function resetCelebratedFlagIfNeeded(context) {
    const lastCheckDateKey = 'lastCelebratedDate';
    const today = getTodayDateStr();
    const lastDate = context.globalState.get(lastCheckDateKey, '');
    if (lastDate !== today) {
        celebratedToday = false;
        context.globalState.update(lastCheckDateKey, today);
    }
}
/**
 * 设置今日目标
 */
async function setDailyGoal(context) {
    const input = await vscode.window.showInputBox({
        prompt: '请输入今日代码行目标（整数）',
        validateInput: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num <= 0) {
                return '请输入大于0的整数';
            }
            return null;
        }
    });
    if (!input) {
        return;
    }
    const goal = parseInt(input);
    await context.globalState.update(DAILY_GOAL_KEY, goal);
    await context.globalState.update(PROGRESS_ENABLED_KEY, true);
    await context.globalState.update(`celebrated_${getTodayDateStr()}`, false);
    updateProgressBar(context);
    vscode.window.showInformationMessage(`今日目标已设为 ${goal} 行，进度条已显示`);
}
/**
 * 切换进度条显示
 */
async function switchProgressBar(context) {
    const enabled = context.globalState.get(PROGRESS_ENABLED_KEY, false);
    await context.globalState.update(PROGRESS_ENABLED_KEY, !enabled);
    if (statusBarItem) {
        if (!enabled) {
            statusBarItem.show();
        }
        else {
            statusBarItem.hide();
        }
    }
    vscode.window.showInformationMessage(`进度条已${!enabled ? '显示' : '隐藏'}`);
}
function activate(context) {
    console.log('Extension "code-line-counter" is now active!');
    const disposable1 = vscode.commands.registerCommand('code-line-counter.analyzeCurrentFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("请先打开一个文件");
            return;
        }
        const document = editor.document;
        const content = document.getText();
        const filePath = document.fileName;
        const ext = path.extname(filePath).toLowerCase();
        const stats = analyzeFile(content, ext);
        vscode.window.showInformationMessage(`文件：${path.basename(filePath)}\n` +
            `总行数：${stats.totalLines}，代码行：${stats.codeLines}` +
            `注释行：${stats.commentLines}，空行：${stats.blankLines}`);
    });
    context.subscriptions.push(disposable1);
    const disposableAnalyzeWorkspace = vscode.commands.registerCommand('code-line-counter.analyzeWorkspace', async () => {
        // 1. 检查工作区
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }
        // 2. 获取用户配置的语言
        const config = vscode.workspace.getConfiguration('code-line-counter');
        const langConfig = config.get('languages', {});
        const enabledLanguages = [];
        if (langConfig.c) {
            enabledLanguages.push({ ext: 'c', lang: 'C' });
        }
        if (langConfig.cpp) {
            enabledLanguages.push({ ext: 'cpp', lang: 'C++' });
        }
        if (langConfig.python) {
            enabledLanguages.push({ ext: 'py', lang: 'Python' });
        }
        if (langConfig.java) {
            enabledLanguages.push({ ext: 'java', lang: 'Java' });
        }
        if (enabledLanguages.length === 0) {
            vscode.window.showErrorMessage('请在设置中启用至少一种语言');
            return;
        }
        // 3. 动态构建文件搜索模式
        const extPattern = enabledLanguages.map(l => l.ext).join(',');
        const pattern = `**/*.{${extPattern}}`;
        // 2. 创建输出通道
        const outputChannel = vscode.window.createOutputChannel('Code Line Counter');
        outputChannel.clear();
        outputChannel.appendLine(`工作区根目录: ${workspaceRoot}`);
        // 3. 智能处理忽略文件（提示生成或更新）
        const ignoreFilePath = path.join(workspaceRoot, '.codelinesignore');
        const hasIgnoreFile = fs.existsSync(ignoreFilePath);
        if (!hasIgnoreFile) {
            // 无忽略文件，询问是否基于当前项目生成
            const answer = await vscode.window.showInformationMessage('未找到 .codelinesignore 忽略文件，是否基于当前项目生成一个？', '生成', '暂不生成');
            if (answer === '生成') {
                await generateSmartIgnoreFile(workspaceRoot);
                outputChannel.appendLine('已生成 .codelinesignore 文件。');
            }
        }
        else {
            // 有忽略文件，检测是否有新增的常见目录未在规则中
            const currentRules = loadIgnoreRules(workspaceRoot); // 临时加载用于检测
            const existingDirRules = currentRules.filter(r => r.endsWith('/'));
            // 获取当前实际存在的常见目录（来自默认规则列表）
            const existingDirs = [];
            for (const dir of DEFAULT_IGNORE_RULES.filter(r => r.endsWith('/'))) {
                const dirPath = path.join(workspaceRoot, dir.replace(/\/$/, ''));
                if (fs.existsSync(dirPath)) {
                    existingDirs.push(dir);
                }
            }
            // 找出存在但规则中缺失的目录
            const missingDirs = existingDirs.filter(dir => !existingDirRules.includes(dir));
            if (missingDirs.length > 0) {
                // 限制显示数量，避免消息过长
                const displayDirs = missingDirs.slice(0, 3).join(', ') + (missingDirs.length > 3 ? '等' : '');
                const answer = await vscode.window.showInformationMessage(`检测到项目中存在可能需要忽略的新目录：${displayDirs}，是否将这些目录添加到 .codelinesignore 中？`, '添加规则', '暂不添加');
                if (answer === '添加规则') {
                    // 追加到文件末尾
                    const content = fs.readFileSync(ignoreFilePath, 'utf-8');
                    const newContent = content + (content.endsWith('\n') ? '' : '\n') + missingDirs.join('\n');
                    fs.writeFileSync(ignoreFilePath, newContent, 'utf-8');
                    vscode.window.showInformationMessage(`已添加 ${missingDirs.length} 条新规则到 .codelinesignore`);
                    outputChannel.appendLine(`已追加 ${missingDirs.length} 条新忽略规则。`);
                }
            }
        }
        // 4. 加载最终使用的忽略规则
        outputChannel.appendLine('正在加载忽略规则...');
        const rules = loadIgnoreRules(workspaceRoot);
        const ig = (0, ignore_1.default)().add(rules);
        outputChannel.appendLine(`忽略规则: ${rules.length} 条`);
        // 5. 查找所有目标文件
        outputChannel.appendLine(`正在搜索文件...`);
        const files = await vscode.workspace.findFiles(pattern);
        if (files.length === 0) {
            outputChannel.appendLine('未找到任何 C/C++/Python/Java 文件');
            outputChannel.show();
            return;
        }
        // 6. 过滤文件（应用忽略规则）
        const filteredFiles = files.filter(file => {
            const absolutePath = file.fsPath;
            const relativePath = path.relative(workspaceRoot, absolutePath);
            const posixPath = relativePath.replace(/\\/g, '/'); // 统一为正斜杠
            return !ig.ignores(posixPath);
        });
        outputChannel.appendLine(`找到 ${files.length} 个文件，忽略后剩余 ${filteredFiles.length} 个`);
        outputChannel.appendLine(`---------------`);
        if (filteredFiles.length === 0) {
            outputChannel.appendLine('所有文件均被忽略规则排除');
            outputChannel.show();
            return;
        }
        const langStats = {};
        for (const lang of enabledLanguages) {
            langStats[lang.lang] = { files: 0, totalLines: 0, codeLines: 0, commentLines: 0, blankLines: 0 };
        }
        let totalStats = { files: 0, totalLines: 0, codeLines: 0, commentLines: 0, blankLines: 0 };
        // 7. 统计文件
        for (const file of filteredFiles) {
            const filePath = file.fsPath;
            const ext = path.extname(filePath).toLowerCase().slice(1); // 去掉点
            const langEntry = enabledLanguages.find(l => l.ext === ext);
            if (!langEntry) {
                continue;
            }
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const stats = analyzeFile(content, `.${ext}`);
                // 更新语言统计
                const lang = langEntry.lang;
                langStats[lang].files++;
                langStats[lang].totalLines += stats.totalLines;
                langStats[lang].codeLines += stats.codeLines;
                langStats[lang].commentLines += stats.commentLines;
                langStats[lang].blankLines += stats.blankLines;
                // 更新总统计
                totalStats.files++;
                totalStats.totalLines += stats.totalLines;
                totalStats.codeLines += stats.codeLines;
                totalStats.commentLines += stats.commentLines;
                totalStats.blankLines += stats.blankLines;
                // 输出每个文件的详细统计
                outputChannel.appendLine(`${path.basename(filePath)}:`);
                outputChannel.appendLine(`  总行数: ${stats.totalLines}`);
                outputChannel.appendLine(`  代码行: ${stats.codeLines}`);
                outputChannel.appendLine(`  注释行: ${stats.commentLines}`);
                outputChannel.appendLine(`  空行: ${stats.blankLines}\n`);
            }
            catch (err) {
                outputChannel.appendLine(`读取文件失败: ${filePath} - ${err}`);
            }
        }
        // 8. 输出分语言统计
        outputChannel.appendLine('========== 按语言统计 ==========');
        for (const [lang, stats] of Object.entries(langStats)) {
            if (stats.files === 0) {
                continue;
            }
            outputChannel.appendLine(`${lang}:`);
            outputChannel.appendLine(`  文件数: ${stats.files}`);
            outputChannel.appendLine(`  总行数: ${stats.totalLines}`);
            outputChannel.appendLine(`  代码行: ${stats.codeLines}`);
            outputChannel.appendLine(`  注释行: ${stats.commentLines}`);
            outputChannel.appendLine(`  空行: ${stats.blankLines}\n`);
        }
        // 9. 输出总计
        outputChannel.appendLine('========== 总计 ==========');
        outputChannel.appendLine(`文件数: ${totalStats.files}`);
        outputChannel.appendLine(`总行数: ${totalStats.totalLines}`);
        outputChannel.appendLine(`代码行: ${totalStats.codeLines}`);
        outputChannel.appendLine(`注释行: ${totalStats.commentLines}`);
        outputChannel.appendLine(`空行: ${totalStats.blankLines}`);
        outputChannel.show();
    });
    // 可选命令：生成默认 .codelinesignore 文件
    const disposableGenerateIgnore = vscode.commands.registerCommand('code-line-counter.generateIgnoreFile', async () => {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }
        await generateDefaultIgnoreFile(workspaceRoot);
    });
    context.subscriptions.push(disposableAnalyzeWorkspace);
    context.subscriptions.push(disposableGenerateIgnore);
    // 可选命令：通过扫描智能生成 .codelinesignore 文件
    const disposableSmartGenerateIgnore = vscode.commands.registerCommand('code-line-counter.generateSmartIgnoreFile', async () => {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }
        await generateSmartIgnoreFile(workspaceRoot);
    });
    context.subscriptions.push(disposableSmartGenerateIgnore);
    // 初始化文档缓存
    vscode.workspace.textDocuments.forEach(doc => {
        if (isSupportedDocument(doc)) {
            docNonBlankLinesCache.set(doc.uri.toString(), countNonBlankLines(doc.getText()));
        }
    });
    const IgWatcher = vscode.workspace.createFileSystemWatcher('**/.codelinesignore');
    IgWatcher.onDidChange(() => {
        cachedIg = null; // 在每次用户更改忽略文件时清除缓存，下次分析时会重新加载规则
    });
    context.subscriptions.push(IgWatcher);
    // 监听变更
    const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
        const doc = event.document;
        if (!isSupportedDocument(doc)) {
            return;
        }
        if (shouldIgnoreFile(doc)) {
            return;
        }
        const uri = doc.uri.toString();
        const current = countNonBlankLines(doc.getText());
        const prev = docNonBlankLinesCache.get(uri) ?? 0;
        const delta = current - prev;
        if (delta > 0) {
            updateTodayLinesAdded(context, delta);
        }
        docNonBlankLinesCache.set(uri, current);
    });
    context.subscriptions.push(changeListener);
    // 监听关闭
    const closeListener = vscode.workspace.onDidCloseTextDocument(doc => {
        docNonBlankLinesCache.delete(doc.uri.toString());
    });
    context.subscriptions.push(closeListener);
    // 状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    // 可选：注册一个命令，让用户可以查看今日代码量
    const showCommand = vscode.commands.registerCommand('code-line-counter.showTodayLines', () => {
        const lines = getTodayLinesAdded(context);
        vscode.window.showInformationMessage(`今日已写 ${lines} 行代码`);
    });
    context.subscriptions.push(showCommand);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
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
    // 恢复进度条状态
    const enabled = context.globalState.get(PROGRESS_ENABLED_KEY, false);
    const goal = context.globalState.get(DAILY_GOAL_KEY, 0);
    if (enabled && goal > 0) {
        updateProgressBar(context);
    }
    else {
        statusBarItem.hide();
    }
}
// 文件分析函数（根据文件扩展名选择解析器）
function analyzeFile(content, ext) {
    const lines = content.split(/\r?\n/);
    let totalLines = lines.length;
    let codeLines = 0;
    let commentLines = 0;
    let blankLines = 0;
    // 根据扩展名设置注释规则
    let singleLineComment = [];
    let multiLineCommentStart = '';
    let multiLineCommentEnd = '';
    if (ext === '.c' || ext === '.cpp' || ext === '.java') {
        singleLineComment = ['//'];
        multiLineCommentStart = '/*';
        multiLineCommentEnd = '*/';
    }
    else if (ext === '.py') {
        singleLineComment = ['#'];
        multiLineCommentStart = '"""';
        multiLineCommentEnd = '"""';
        // Python 还有 ''' 作为多行字符串，简单起见我们可以先处理一种
    }
    let inMultiLineComment = false;
    for (let line of lines) {
        const trimmed = line.trim();
        // 空行判断
        if (trimmed === '') {
            blankLines++;
            continue;
        }
        // 处理多行注释（简单实现，不考虑字符串内等复杂情况）
        if (!inMultiLineComment && multiLineCommentStart && trimmed.startsWith(multiLineCommentStart)) {
            inMultiLineComment = true;
            // 如果这一行同时结束（如 /* comment */）
            if (multiLineCommentEnd && trimmed.includes(multiLineCommentEnd)) {
                inMultiLineComment = false;
            }
            commentLines++;
            continue;
        }
        if (inMultiLineComment) {
            commentLines++;
            if (multiLineCommentEnd && trimmed.includes(multiLineCommentEnd)) {
                inMultiLineComment = false;
            }
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
        // 其余算代码行
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
function deactivate() { }
//# sourceMappingURL=extension.js.map
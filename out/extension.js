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
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "code-line-counter" is now active!');
    // The command is defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable1 = vscode.commands.registerCommand('code-line-counter.countLines', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }
        const text = editor.document.getText();
        const lines = text.split('\n');
        const totalLines = lines.length;
        vscode.window.showInformationMessage(`总行数: ${totalLines}`);
    });
    context.subscriptions.push(disposable1);
    const disposable2 = vscode.commands.registerCommand('code-line-counter.analyzeWorkspace', async () => {
        // 1.检查是否打开了工作区
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }
        // 2.创建输出通道
        const outputChannel = vscode.window.createOutputChannel('Code Line Counter');
        outputChannel.clear();
        outputChannel.appendLine('正在分析工作区...\n');
        // 3. 用 findFiles 查找所有目标文件
        const pattern = '**/*.{c,cpp,py,java}';
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**'); // 排除 node_modules
        if (files.length === 0) {
            outputChannel.appendLine('未找到任何 C/C++/Python/Java 文件');
            outputChannel.show();
            return;
        }
        let totalStats = {
            files: 0,
            totalLines: 0,
            codeLines: 0,
            commentLines: 0,
            blankLines: 0
        };
        // 4. 遍历每个文件，统计
        for (const file of files) {
            const filePath = file.fsPath;
            const ext = path.extname(filePath).toLowerCase();
            // 读取文件内容（注意编码）
            const content = fs.readFileSync(filePath, 'utf-8');
            const stats = analyzeFile(content, ext);
            // 输出每个文件的统计
            outputChannel.appendLine(`${path.basename(filePath)}:`);
            outputChannel.appendLine(`  总行数: ${stats.totalLines}`);
            outputChannel.appendLine(`  代码行: ${stats.codeLines}`);
            outputChannel.appendLine(`  注释行: ${stats.commentLines}`);
            outputChannel.appendLine(`  空行: ${stats.blankLines}\n`);
            // 累加总数
            totalStats.files++;
            totalStats.totalLines += stats.totalLines;
            totalStats.codeLines += stats.codeLines;
            totalStats.commentLines += stats.commentLines;
            totalStats.blankLines += stats.blankLines;
        }
        // 输出总计
        outputChannel.appendLine('========== 总计 ==========');
        outputChannel.appendLine(`文件数: ${totalStats.files}`);
        outputChannel.appendLine(`总行数: ${totalStats.totalLines}`);
        outputChannel.appendLine(`代码行: ${totalStats.codeLines}`);
        outputChannel.appendLine(`注释行: ${totalStats.commentLines}`);
        outputChannel.appendLine(`空行: ${totalStats.blankLines}`);
        // 显示输出面板
        outputChannel.show();
    });
    context.subscriptions.push(disposable2);
}
// 文件分析函数（根据文件扩展名选择解析器）
function analyzeFile(content, ext) {
    //TODO: 这个函数虽然或许能够统计不同代码文件的行数，但是在工作区有.venv等文件夹时会有问题，后续需要改进;
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
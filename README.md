# Code Line Counter : Beta Test

这是一个为 VS Code 打造的代码行统计插件，目前支持 **C/C++、Python、Java** 三种语言的精准统计，并提供智能忽略规则、进度条目标追踪、Excel 导出等实用功能。

---

## 主要功能

### 代码行统计
- **Analyze Current File**：快速查看当前文件的**总行数、代码行、注释行、空行**。 
- **Analyze Workspace**：扫描整个项目，按**语言分类**汇总，并输出详细文件列表。
- **支持的语言**：C、C++、Python、Java（可在设置中配置启用/禁用）。

    *工作区统计结果会输出到**终端**

### 智能忽略规则
- 内置常见忽略目录（如 `.git/`、`node_modules/`、`__pycache__/` 等），开箱即用。
- **Generate Default .codelinesignore**：生成默认忽略文件。
- 通过 `.codelinesignore` 文件，支持自定义忽略规则（兼容 `.gitignore` 语法）。
- **Generate Smart .codelinesignore**：根据默认忽略目录，检测项目中存在的常见目录，一键生成忽略文件。
- **实时更新**：修改 `.codelinesignore` 后自动刷新，下次统计立即生效。
    
    *用户自定义的忽略目录，若不在默认忽略目录库中，则在之后调用智能生成忽略文件函数时，不会被覆盖

### 进度条目标追踪
- **Set Today's Goal**，状态栏实时显示进度条（格式：`██████░░░░ 300/500 lines (60%)`，***支持自定义:D***）。
- 只统计**非空白行**的新增行数（仅按回车产生的新行且非空才计入）。
- 完成目标时弹出庆祝通知，***这里也支持自定义内容:D***。

### 导出为 Excel
- 将工作区统计结果导出为 `.xlsx` 文件，包含**按语言统计**和**文件详情**两个工作表。

### 便捷操作
- **右键菜单集成**：在编辑器或资源管理器中右键 → `Line Counter` → 选择命令。
- **命令面板**：所有命令均可通过 `Ctrl+Shift+P` 搜索执行。
- **快捷键绑定**：可通过右键菜单查看快捷键。

---

## 🚀 让我们开始吧！

1. 打开一个包含 C/C++/Python/Java 代码的项目。
2. 在命令面板中搜索 `CLC: Analyze Workspace` 查看统计结果。
3. （可选）设置每日目标：`CLC: Set Today's Goal`。

---

## 🔧 配置

通过 VS Code 设置 (`Ctrl+,`) 搜索 `code-line-counter` 可配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `languages.c` | 启用 C 语言统计 | `true` |
| `languages.cpp` | 启用 C++ 语言统计 | `true` |
| `languages.h` | 启用c语言头文件统计 | `true` |
| `languages.hpp` | 启用cpp语言头文件统计 | `true` |
| `languages.python` | 启用 Python 统计 | `true` |
| `languages.java` | 启用 Java 统计 | `true` |

**忽略规则**：在项目根目录创建 `.codelinesignore` 文件，每行一条规则（支持 `#` 注释）。若文件不存在，插件将使用内置默认规则。

---

## 📋 命令列表

| 命令 | 说明 |
|------|------|
| `CLC: Analyze Current File` | 统计当前打开文件的行数 |
| `CLC: Analyze Workspace` | 统计整个工作区的代码行数（按语言分类） |
| `CLC: Reset Today's Lines` | 重置今日已统计代码量 |
| `CLC: Show Total Lines` | 显示插件激活以来总计代码量 |
| `CLC: Set Today's Goal` | 设置今日代码行目标，启用进度条 |
| `CLC: Switch On/Off Progress Bar` | 显示/隐藏进度条 |
| `CLC: Show Today's Number of Lines` | 显示今日已写代码行数 |
| `CLC: Export to Excel` | 导出统计结果为 Excel 文件 |
| `CLC: Generate Default .codelinesignore` | 生成默认的 `.codelinesignore` 文件 |
| `CLC: Generate Smart .codelinesignore` | 智能生成忽略文件（仅包含项目中实际存在的目录） |

---

## 📝 注意事项

- 统计的“新增行数”仅统计**非空白行**（通过按下回车创建新行并输入内容），编辑已有行不会计数。
- 忽略规则仅影响工作区统计和进度条统计，不影响手动分析单个文件。
- 进度条数据保存在 VS Code 全局状态中，跨日自动重置。

## 源代码
项目源代码托管在[GitHub](https://github.com/Kehao-XU/code-line-counter)上，欢迎来玩。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
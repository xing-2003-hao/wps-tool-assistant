## 邢浩

AIAgent开发/Python后端工程师男·22岁·16668468990·2018381151@qq.com GitHub:github.com/xing-2003-hao期望城市：烟台/青岛期望薪资：10-13K

### 个人优势

- AIAgent工程实战：深度参与工业级AIAgent系统（歌尔NCAgent，GitHub协作176次提交，22位贡献者
中排名第5），并独立自研Agent内核（Think-Act-Observe循环、SOP的DAG编排、多模型网关与降级），覆盖从内核到业务落地的完整链路。

- 后端主力Python：熟练使用FastAPI/Flask/Django，掌握SQLAlchemy2.0异步ORM、Pydantic数据校验、
Celery异步任务、WebSocket实时推送，能独立完成后端架构设计与接口开发。

- 多模型与成本控制：具备火山方舟（豆包）、DeepSeek、OpenAI兼容接口的统一网关设计经验，按任务类型与
部门做路由分发、失败自动降级、Token与成本埋点。

- 全栈交付能力：前端覆盖Vue3+Vite+TS、React18/19+Next.js、uni-app多端小程序，熟悉ECharts与
Three.js，可独立完成从后端到前端的完整项目交付。

- 工程化习惯良好：注重脚本模块化拆分、生产/开发双模式、分级日志与耗时埋点、异常兜底与并发控制，有
Docker、conda、py测试、Git协作开发的实际经验。

### 专业技能

AI/Agent：LangGraph、LangChain、自研Agent内核（调度器/SOP引擎/事件总线/工具执行器）、多模型网关（豆包/DeepSeek/OpenAI兼容）、提示词工程、RAG与记忆机制后端框架：FastAPI（主力）、Flask、Django、SQLAlchemy2.0async、Pydanticv2、JWT+Bcrypt鉴权、 Celery、WebSocket 数据库/中间件：MySQL8、Redis（缓存/Stream消息队列/Token黑名单）、SQLite 前端：Vue3+Vite+TypeScript、React18/19+Next.js、uni-app（微信/抖音/快手小程序）、ECharts、 Three.js、AntDesign、Tailwind 数据处理：Requests+XPath/正则、Pandas清洗与统计、NumPy 工程化：Git、Docker、conda、py测试、Loguru日志、SiemensNXOpenAPI二次开发

### 项目经历

歌尔NCAgent—工业AI刀路自动生成系统 2026.03-2026.08|核心开发 GitHub协作项目（congelation/Goertek_NC_Agent）·个人提交176次，团队22位贡献者中排名第5


面向精密零件加工的AI刀路自动生成系统。基于SiemensNX二次开发，将零件3D模型自动转化为可执行的 CNC加工刀路、程序组与加工单，替代大量人工编程操作。系统采用FastAPI+LangGraph多智能体架构，前端 Next.js+Three.js实现图纸与刀路的可视化。

技术栈：Python、FastAPI、LangGraph、SiemensNXOpenAPI、Celery、Redis、WebSocket、Next.js16、 React19、Three.js

- 工序自动化构建：实现固定轮廓铣、型腔铣、深度轮廓铣、面铣、底壁铣开粗、钻孔、铣孔、倒角、切料、去毛
刺等10+种工序的NX刀路自动创建与参数配置。

- 几何选面与选刀算法：设计基于特征识别的选面规则（圆柱面/圆锥面/修剪面/侧壁判定），引入迭代补救与漏
选兜底机制，显著降低误选率；按材料、余量设计选刀策略与刀具库。

- 程序分组与工序排序：实现按加工方向、刀具类型、加工余量、工序关键字的多维分组策略，保证工序顺序符合
工艺约束，并自动清理空刀轨与空程序组。

- 加工单与后处理：开发加工单自动生成模块（G代码正则解析、工时/刀具/刀柄数据提取、NX截图插入、坐标
系标注）；修复后处理附件漏收、文件读取失败等线上问题。

- 工程化重构与稳定性：将巨型脚本拆分为按工序的独立模块并改为动态加载注册；建立生产/开发双模式、分级
日志与工序耗时埋点、超时兜底机制；实现机器码授权校验与前端鉴权联动。

- 前端协作：修复工序执行状态刷新不及时、图纸任务标识等交互问题，配合WebSocket实现加工进度实时推
送。

aigongsi—AI全员工公司（多智能体协作平台） 2026.09|独立开发 github.com/xing-2003-hao/aigongsi·约1.45万行代码（Python5.7K+Vue3.6K）一家全员由AI组成的虚拟公司系统：5名高管+19个部门+74个AI岗位，Agent之间按SOP自动协作完成接单、需求分析、产品设计、开发、测试、交付与结算的全流程。

技术栈：FastAPI、SQLAlchemy2.0async、MySQL8、RedisStream、Vue3+Vite+TypeScript、ECharts、火山方舟（豆包）+DeepSeek

- 自研Agent内核：实现Think-Act-Observe执行循环与工具执行器；调度器支持SOP的DAG编排，具备并行分
支与join汇聚能力，并将每一步的耗时、Token、成本落库。

- 多模型网关：统一封装火山方舟豆包与DeepSeek，按部门与任务类型路由（代码/推理类走DeepSeek，创意/
决策类走豆包），配合tenacity重试与失败自动降级。

- 实时消息与事件：基于RedisStream实现Agent消息总线（消费者组+XACK确认），基于asyncio.Queue实
现事件总线，将SOP运行状态实时推送至前端画布。

- 组织建模与持久化：用YAML定义5高管/19部门/74岗位的角色、目标、背景与模型偏好，通过初始化脚本
灌入MySQL（17张表），支持按岗位动态构建Agent实例。

- 管理后台：开发12个Vue3页面（驾驶舱、组织架构、部门详情、SOP执行画布、运行历史、财务、客户
等），实现SOP全流程可视化追踪与成本看板。

- 代码自动生成：实现将AI产出转化为完整可运行项目（FastAPI后端+Vue前端）的生成器，包含代码块提取、
import依赖修复与可运行性校验。

StoryToVideo—AI故事转视频平台（AIGC流水线） 2026.08|独立开发


github.com/xing-2003-hao/myapp 将小说/故事文本自动转化为视频的AIGC流水线平台，采用节点式画布编排生产流程，针对4GB显存的消费级显卡做了显存调度优化。

技术栈：FastAPI、ReactFlow、StableDiffusion/ComfyUI、LivePortrait、Kling可灵API、DeepSeek、React+ TypeScript

- 流水线设计：搭建「故事分析→角色定妆→漫画图生成→旁白配音→口型同步数字人→运镜视频→剪辑导
出」节点式生成链路，各节点可独立复用与重跑。

- 多模型集成与显存调度：接入ComfyUI/SD定妆、LivePortrait口型同步、Kling可灵运镜；GPU密集型节点串
行排队执行，完成后主动释放显存，适配4GB显存环境。

- 前端实现：基于ReactFlow实现画布，持久化图结构、节点参数与产物URL（刷新不丢失），并提供生成进度
提示与多会话记录管理。

- 质量修复：解决视频导出音频丢失、3D定妆性别错乱、提示词质量不稳定等实际生成问题。
字了个字—成语三消小游戏（多端小程序） 2026.08|独立开发 github.com/xing-2003-hao/xiaochengxu·Uni-app一套代码多端发布面向11-18岁学生的成语三消益智游戏，玩法类似「羊了个羊」，第1关教学、第2关起难度倍增（4字成语顺序消除）。

技术栈：Uni-app（Vue3+Vite+Canvas）、FastAPI、TypeScript，发布至微信/抖音/快手/鸿蒙小程序

- 核心算法：实现确定性随机的多层牌堆生成算法，保证关卡可解性；设计12关难度曲线（层数、槽位、成语数、
干扰比例递增）。

- 成语库建设：构建分级成语库85条（L1小学/L2初中/L3生僻），并加入形近字组与多义字索引以提升难度层
次。

- 前后端实现：后端提供关卡配置、棋盘生成与消除校验API；前端使用Canvas渲染牌堆与消除动画。
lian—AgentFramework与问卷任务平台 2026.03-2026.09|独立开发 github.com/xing-2003-hao/lian·22次提交自研AgentFramework并落地业务应用：在框架之上构建问卷下发、任务管理与AI自动批改能力。

技术栈：FastAPI、LangGraph、SQLAlchemyasync、MySQL、Redis、React18+ReduxToolkit+AntDesign+ ECharts

- 框架设计：实现Agent生命周期管理、任务调度、消息通信、能力管理与监控日志五大模块，配套React管理后
台。

- 认证体系：实现bcrypt密码加密+JWT签发与刷新+RedisToken黑名单+账户锁定+审计日志的完整鉴权链
路。

- 业务模块：完成问卷配置与下发、任务下发与提交、AI助手接入、AI自动打分与改卷。
### 早期实践

- 智能天气交互平台（Flask+Vue+ECharts）：定时爬取天气数据入库，后端提供天气查询、AI对话、登录注册
等接口。


- 电影网站爬虫及可视化（Requests+XPath+Pandas+MySQL+ECharts）：设计「爬取-清洗-存储-可视
化」全流程方案并落地。

- 校园二手交易平台（Django+Vue+MySQL+Redis）：独立完成商品、订单、用户三大模块20+个后端API，
关键接口响应优化约40%。

### 教育经历

河南科技职业大学·本科·计算机应用工程 2021.09-2025.06 专业排名前20%；主修课程：计算机基础、数据库技术及应用、前端设计与开发、Python编程。

校内实践：主导开发学生管理系统（Python+MySQL），参与智慧校园项目并负责后端API接口开发。


# 卡密服务端部署说明

零依赖 Node 服务：卡密生成 / 激活 / 校验 + 官网落地页 + 安装包分发，一个进程全包。

## 本地试跑

```bash
node server/server.js          # 默认 http://127.0.0.1:3910
```

启动时会打印管理员密钥（也保存在 `server/data/admin-key.txt`）。

## 部署到云服务器（推荐）

任意一台有公网 IP 的 Windows/Linux VPS，装 Node ≥ 16：

```bash
# 1. 上传三个目录到服务器，如 /opt/wta/
#    server/  site/  dist/
cd /opt/wta/server

# 2. 设置管理员密钥（重要，别用自动生成的）
export WTA_ADMIN_KEY=你的管理密钥

# 3. 常驻运行（Linux 用 pm2；Windows 用计划任务或 nssm）
npm install -g pm2
PORT=80 pm2 start server.js --name wta-server && pm2 save && pm2 startup

# 4. 验证
curl http://你的服务器IP/api/verify -X POST -H "Content-Type: application/json" -d '{}'
# 期望返回 {"valid":false}
```

之后访问 `http://你的域名或IP/` 就是官网，`http://…/download/WPS工具助手-安装启动.exe` 就是安装包下载。

> 有域名的话前面加一层 Nginx 反代 + HTTPS 即可；没有域名直接 IP + 80 端口也能用。

## 面板侧接线（发给用户前做一次）

**完整版 exe 已内置激活地址**：`common/license.js` 顶部的 `DEFAULT_API`（当前是本机 `http://127.0.0.1:3910`，用于本地测试）。服务器部署好后，把它改成你的公网地址：

```js
var DEFAULT_API = 'https://你的域名';   // 置为 '' 则变回全放行的免费版
```

然后 `npm run sync && npm run build:exe2` 重新打包。改完后：AI 功能默认上闸（未激活弹激活窗），离线工具保持免费，用户无需手填服务器地址。

## 模板中心

模板存在 `templates` 表里，客户端面板「模板」页按套餐拉取，服务端二次校验后才下发正文。

```bash
# 客户端视角：未激活 → 只有 free 模板可解锁（locked=false）
curl "$BASE/api/templates?token=&machine=ABC123"

# 已订阅 → 7/8 解锁，enterprise 模板仍锁
curl "$BASE/api/templates?token=xxxxxxxx"

# 拉正文（服务端会再查一次套餐，没权限直接 403）
curl "$BASE/api/templates/1?token=xxxxxxxx"

# 管理台：列表 / 新建或更新 / 上下架 / 删除
curl $BASE/api/admin/templates -H "X-Admin-Key: $ADMIN"
curl -X POST $BASE/api/admin/templates -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" \
     -d '{"name":"报价单","category":"销售","plan":"pro","summary":"三档报价对比","body":"# 报价单\n\n## 一、报价明细\n\n| 项目 | 单价 | 数量 | 金额 |\n| --- | --- | --- | --- |\n|  |  |  |  |"}'
curl -X POST $BASE/api/admin/templates/toggle -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"id":1,"enabled":false}'
```

模板正文用轻量 Markdown，客户端会渲染成 Word：`# 一级标题`、`## 二级标题`、`### 三级标题`、`- 列表`、`| a | b |` 表格、`**加粗**`（渲染时去标记）。

套餐等级：`free(0) < trial(1) < pro(2) < enterprise(3)`。模板的 `plan` 表示"至少需要哪一档"。

`enterprise` 档不对外售卖，只由管理员授权：

```bash
# 给某用户开企业档（长期有效，模板全解锁）
curl -X POST $BASE/api/admin/users/ent -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"uid":"U000009","on":true}'
# 收回
curl -X POST $BASE/api/admin/users/ent -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"uid":"U000009","on":false}'
```

用户取消企业授权后若还有有效卡密，档位会**自动回落到该卡的 pro**，不会变成 free。

## 多管理员

两种凭据等价可用：

| 凭据 | Header | 权限 |
|---|---|---|
| 管理密钥 | `X-Admin-Key: xxx` | owner（本机后门，bootstrap 自动读取） |
| 登录 token | `Authorization: Bearer xxx` | 按账号角色 |

初始超管 `admin` / `admin123`（服务首次连接 MySQL 时自动创建，**登录后请改密**）。token 有效期 7 天，存在内存，服务重启即失效。

```bash
# 登录拿 token
T=$(curl -s -X POST $BASE/api/admin/login -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 用 token 调任意管理接口
curl $BASE/api/admin/keys -H "Authorization: Bearer $T"

# 加一个普通管理（只能日常操作，不能管账号）
curl -X POST $BASE/api/admin/admins/add -H "Authorization: Bearer $T" \
     -H "Content-Type: application/json" -d '{"username":"xiaowang","password":"abc12345","role":"manager"}'

# 重置密码 / 删除（删除最后一个 owner 会被拒绝）
curl -X POST $BASE/api/admin/admins/pass -H "Authorization: Bearer $T" \
     -H "Content-Type: application/json" -d '{"id":2,"password":"newpass99"}'
curl -X POST $BASE/api/admin/admins/del -H "Authorization: Bearer $T" \
     -H "Content-Type: application/json" -d '{"id":2}'
```

角色：`owner` 可管账号；`manager` 只能发卡、查账、管用户和模板，访问 `/api/admin/admins*` 返回 403。

## 管理操作（curl 示例）

```bash
ADMIN=你的管理密钥; BASE=http://你的服务器

# 生成 10 张 30 天卡密（带单价和渠道，自动记一笔收入）
curl -X POST $BASE/api/admin/keys -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" \
     -d '{"count":10,"days":30,"price":29.9,"channel":"微信"}'

# 经营概览：今日/本月/累计收入、活跃用户、7 天内到期
curl $BASE/api/admin/stats -H "X-Admin-Key: $ADMIN"

# 收入明细 / 操作日志
curl "$BASE/api/admin/orders?limit=60" -H "X-Admin-Key: $ADMIN"
curl "$BASE/api/admin/events?limit=200" -H "X-Admin-Key: $ADMIN"

# 续费 30 天，并记一笔 19.9 元收入（不填 amount 则只延期）
curl -X POST $BASE/api/admin/keys/extend -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" \
     -d '{"code":"WTA-XXXX-XXXX-XXXX","days":30,"amount":19.9}'

# 列出全部卡密（含绑定设备、到期时间）
curl $BASE/api/admin/keys -H "X-Admin-Key: $ADMIN"

# 用户换电脑 → 重置绑定（原设备立即失效）
curl -X POST $BASE/api/admin/keys/reset -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"code":"WTA-XXXX-XXXX-XXXX"}'

# 退款/封禁 → 停用；恢复传 {"code":"…","disabled":false}
curl -X POST $BASE/api/admin/keys/disable -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"code":"WTA-XXXX-XXXX-XXXX"}'

# 删掉单张卡密（误生成/作废，不可恢复）
curl -X POST $BASE/api/admin/keys/delete -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"code":"WTA-XXXX-XXXX-XXXX"}'

# 一键清空所有「未激活」的卡密（已激活/已停用的不动）
curl -X POST $BASE/api/admin/keys/delete -H "X-Admin-Key: $ADMIN" \
     -H "Content-Type: application/json" -d '{"unused":true}'
```

## 客户端行为规则（common/license.js）

| 情况 | 行为 |
|---|---|
| 面板未配置激活服务器地址 | 全功能放行（默认，老用户无感） |
| 用户在「设置」页填了自己的 API Key | AI 功能放行（自带钥匙不收费） |
| 已激活且未过期 | 放行，每 24h 静默校验一次 |
| 服务器暂时不可达 | 72 小时离线宽限，不坑付费用户 |
| 未激活 / 过期 / 被重置 | AI 调用前弹激活窗；离线工具永远免费 |

## 数据与安全

- 卡密数据在 `server/data/licenses.json`，**定期备份这个文件**
- 每张卡密绑定一台设备（machine id），重置才能换机
- token 由服务端签发，客户端只存 token 不存卡密明文以外的凭据
- 自测：先起服务端，再跑 `node scripts/selftest-license.js`（17 项）

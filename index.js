import plugin from '../../lib/plugins/plugin.js'
import config from './config.js'
import { segment } from 'oicq'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import os from 'os'
import { takeScreenshot, takeDetailScreenshot } from './puppeteer.js'
import { extractProjectIdFromUrl, getProjectVersionsFormatted } from './api.js'

// 获取当前文件所在目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 会话存储：userId -> { category, query, timestamp, messageId, resourceUrls }
const userSessions = new Map()

/**
 * Modrinth 资源搜索插件
 * 支持在 Modrinth.com 搜索 Minecraft 相关资源并返回截图
 */
export class ModrinthSearch extends plugin {
    constructor() {
        super({
            name: 'Modrinth资源搜索',
            dsc: 'Minecraft资源搜索插件，支持在Modrinth搜索模组、资源包等',
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: '^#mr帮助$',
                    fnc: 'showHelp'
                },
                {
                    reg: '^#mrhelp$',
                    fnc: 'showHelp'
                },
                {
                    reg: '^#mr\\s+(.+)$',
                    fnc: 'search'
                },
                {
                    reg: '^p(\\d+)$',
                    fnc: 'paginate'
                },
                {
                    reg: '^g(\\d+)$',
                    fnc: 'viewDetail'
                },
                {
                    reg: '^version$',
                    fnc: 'viewVersions'
                },
                {
                    reg: '^v$',
                    fnc: 'viewVersions'
                },
                {
                    reg: '^v(\\d+)$',
                    fnc: 'paginateVersions'
                },
                {
                    reg: '^d(\\d+)$',
                    fnc: 'downloadVersion'
                }
            ]
        })
    }

    /**
     * 保存 Buffer 为临时文件
     * @param {Buffer} buffer 图片数据
     * @returns {string} 临时文件路径
     */
    saveTempImage(buffer) {
        const tempDir = path.join(__dirname, 'temp')
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true })
        }
        const tempFile = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
        fs.writeFileSync(tempFile, buffer)
        return tempFile
    }

    /**
     * 显示帮助信息
     */
    async showHelp(e) {
        logger.mark('[Modrinth] 显示帮助页面')

        try {
            // 读取 HTML 模板
            const htmlPath = path.join(__dirname, 'help.html')
            const htmlContent = fs.readFileSync(htmlPath, 'utf-8')

            // 使用 Puppeteer 渲染
            const puppeteer = (await import('puppeteer')).default
            const browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            })

            const page = await browser.newPage()
            await page.setViewport({ width: 960, height: 1400 })
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' })

            // 截图
            const screenshot = await page.screenshot({
                type: 'png',
                fullPage: true
            })

            await browser.close()

            // 保存并发送帮助图片
            const tempFile = this.saveTempImage(screenshot)
            await e.reply([
                segment.image(tempFile)
            ])

            logger.mark('[Modrinth] 帮助页面发送成功')
        } catch (err) {
            logger.error('[Modrinth] 显示帮助失败:', err)
            await e.reply(`❌ 生成帮助页面失败\n错误: ${err.message}`)
        }

        return true
    }

    /**
     * 搜索功能主函数
     */
    async search(e) {
        logger.mark('[Modrinth] 收到搜索请求')
        logger.mark(`[Modrinth] 用户ID: ${e.user_id}`)
        logger.mark(`[Modrinth] 原始消息: ${e.msg}`)

        // 解析指令：/mr [分类] [内容]
        const match = e.msg.match(/^#mr\s+(.+)/)
        if (!match || !match[1]) {
            await e.reply(config.messages.emptySearch)
            return true
        }

        // 分割参数
        const params = match[1].trim().split(/\s+/)
        if (params.length < 2) {
            await e.reply(config.messages.emptySearch)
            return true
        }

        const categoryInput = params[0].toLowerCase()
        const searchQuery = params.slice(1).join(' ')

        logger.mark(`[Modrinth] 分类输入: ${categoryInput}`)
        logger.mark(`[Modrinth] 搜索内容: ${searchQuery}`)

        // 检查是否是直接详情搜索 (s 参数)
        // 优先检查 s 参数，避免被 mapCategory 拦截
        let isDirectDetail = false
        if (categoryInput === 's') {
            if (params.length < 3) {
                await e.reply('❌ 参数不足！\n用法: #mr s <分类> <资源名>')
                return true
            }

            // #mr s <分类> <资源名>
            isDirectDetail = true
            // 重新映射真实的分类
            const realCategoryInput = params[1].toLowerCase()
            const realCategory = this.mapCategory(realCategoryInput)
            if (!realCategory) {
                await e.reply(config.messages.invalidCategory)
                return true
            }

            // 重构参数
            const realSearchQuery = params.slice(2).join(' ')
            if (!realSearchQuery) {
                await e.reply(config.messages.emptySearch)
                return true
            }

            logger.mark(`[Modrinth] 直接查看详情: ${realCategory} - ${realSearchQuery}`)
            await e.reply('🔍 正在加载资源详情...')

            // 构建详情页URL
            let type = realCategory
            if (type === 'mods') type = 'mod'
            else if (type === 'resourcepacks') type = 'resourcepack'
            else if (type === 'datapacks') type = 'datapack'
            else if (type === 'shaders') type = 'shader'
            else if (type === 'modpacks') type = 'modpack'
            else if (type === 'plugins') type = 'plugin'

            const slug = realSearchQuery.toLowerCase().replace(/\s+/g, '-')
            const detailUrl = `${config.baseUrl}/${type}/${slug}`

            try {
                const screenshot = await takeDetailScreenshot(detailUrl)

                const tempFile = this.saveTempImage(screenshot)
                const detailResult = await e.reply([
                    `【Modrinth】${realSearchQuery}`,
                    segment.image(tempFile)
                ])

                if (detailResult?.message_id) {
                    const msgIdStr = String(detailResult.message_id)
                    const session = {
                        detailMessageIds: [msgIdStr],
                        detailMessageMap: {
                            [msgIdStr]: {
                                url: detailUrl,
                                name: realSearchQuery,
                                index: 0
                            }
                        },
                        timestamp: Date.now()
                    }
                    this.saveSession(e.user_id, session)
                    logger.mark(`[Modrinth] 记录详情页消息ID: ${msgIdStr}`)
                }
                return true
            } catch (err) {
                logger.error('[Modrinth] 直接详情搜索失败:', err)
                await e.reply('❌ 加载详情页失败，请检查资源名称是否正确')
                return true
            }
        }

        // 映射分类
        const category = this.mapCategory(categoryInput)
        if (!category) {
            await e.reply(config.messages.invalidCategory)
            return true
        }

        const categoryDisplayName = categoryInput // 简单使用用户输入作为显示名称，或者可以做一个映射表

        try {
            // 发送加载提示
            await e.reply(config.messages.loading)

            // 构建搜索 URL
            const searchUrl = this.buildSearchUrl(category, searchQuery)
            logger.mark(`[Modrinth] 搜索URL: ${searchUrl}`)

            // 使用 Puppeteer 截图（首次搜索）
            const { screenshot, resourceNames, resourceUrls } = await takeScreenshot(searchUrl, category)

            // 构建资源名称列表
            let namesText = ''
            if (resourceNames && resourceNames.length > 0) {
                namesText = '\n\n【资源列表】\n' + resourceNames.map((name, index) => `${index + 1}. ${name}`).join('\n')
            }

            // 发送截图并记录消息ID
            const tempFile = this.saveTempImage(screenshot)
            const sendResult = await e.reply([
                `【Modrinth】: ${categoryDisplayName}\n【关键词】: ${searchQuery}\n【页码】: 1\n【翻页】: 回复 p2、p3... 进行翻页${namesText}`,
                segment.image(tempFile)
            ])

            // 保存会话信息（首次搜索，不记录提示消息ID）
            this.saveSession(e.user_id, {
                category,
                query: searchQuery,
                timestamp: Date.now(),
                messageId: sendResult?.message_id || null,
                promptMessageId: null,  // 首次搜索的提示ID不记录，永不撤回
                page: 1,
                resourceUrls: resourceUrls || [],
                resourceNames: resourceNames || [],
                detailMessageIds: [],  // 存储详情页消息ID
                detailMessageMap: {}   // 映射：详情页消息ID -> {url, name, index}
            })

            logger.mark('[Modrinth] 搜索完成')

        } catch (err) {
            logger.error('[Modrinth] 搜索失败:', err)
            await e.reply(`${config.messages.searchFailed}\n错误: ${err.message}`)
        }

        return true
    }

    /**
     * 翻页功能
     */
    async paginate(e) {
        logger.mark('[Modrinth] 收到翻页请求')
        logger.mark(`[Modrinth] 用户ID: ${e.user_id}`)

        // 检查是否回复了消息
        if (!e.reply_id) {
            await e.reply(config.messages.noReplyContext)
            return true
        }

        // 检查会话是否存在
        const session = this.getSession(e.user_id)
        if (!session) {
            await e.reply(config.messages.sessionExpired)
            return true
        }

        // 检查是否回复的是详情页消息
        if (session.detailMessageIds && session.detailMessageIds.includes(String(e.reply_id))) {
            logger.mark('[Modrinth] 用户回复的是详情页消息，忽略翻页指令')
            return true  // 不做任何回复
        }

        // 提取页码
        const match = e.msg.match(/^p(\d+)$/)
        if (!match) {
            await e.reply(config.messages.invalidPage)
            return true
        }

        const page = parseInt(match[1])
        if (page < 1) {
            await e.reply(config.messages.invalidPage)
            return true
        }

        logger.mark(`[Modrinth] 翻页到第 ${page} 页`)

        const categoryDisplayName = config.categoryDisplayNames[session.category]

        try {
            // 构建搜索 URL（包含分页参数）
            const searchUrl = this.buildSearchUrl(session.category, session.query, page)
            logger.mark(`[Modrinth] 搜索URL: ${searchUrl}`)

            // 撤回上一次的消息（结果和提示）
            await this.recallPreviousMessages(e, session)

            // 发送加载提示
            const promptMsg = await e.reply(config.messages.pageLoading.replace('{page}', page))

            // 使用 Puppeteer 截图（翻页，依然需要点击UI）
            const { screenshot, resourceNames, resourceUrls } = await takeScreenshot(searchUrl, session.category)

            // 构建资源名称列表
            let namesText = ''
            if (resourceNames && resourceNames.length > 0) {
                namesText = '\n\n【资源列表】\n' + resourceNames.map((name, index) => `${index + 1}. ${name}`).join('\n')
            }

            // 发送截图
            const tempFile = this.saveTempImage(screenshot)
            const resultMsg = await e.reply([
                `【Modrinth】: ${categoryDisplayName}\n【关键词】: ${session.query}\n【页码】: ${page}\n【翻页】: 回复 p${page + 1}... 进行翻页${namesText}`,
                segment.image(tempFile)
            ])

            // 更新会话，记录当前页的消息ID
            session.messageId = resultMsg?.message_id || null
            session.promptMessageId = promptMsg?.message_id || null
            session.page = page
            session.timestamp = Date.now()
            session.resourceUrls = resourceUrls || []
            session.resourceNames = resourceNames || []
            // detailMessageIds 保持不变，继续累积
            this.saveSession(e.user_id, session)

            logger.mark('[Modrinth] 翻页完成')

        } catch (err) {
            logger.error('[Modrinth] 翻页失败:', err)
            await e.reply(`${config.messages.searchFailed}\n错误: ${err.message}`)
        }

        return true
    }

    /**
     * 查看资源详情
     */
    async viewDetail(e) {
        logger.mark('[Modrinth] 收到详情查看请求')
        logger.mark(`[Modrinth] 用户ID: ${e.user_id}`)

        // 检查是否回复了消息
        if (!e.reply_id) {
            await e.reply('❌ 请回复搜索结果消息来查看详情')
            return true
        }

        // 检查会话是否存在
        const session = this.getSession(e.user_id)
        if (!session) {
            await e.reply(config.messages.sessionExpired)
            return true
        }

        // 检查是否回复的是详情页消息
        if (session.detailMessageIds && session.detailMessageIds.includes(String(e.reply_id))) {
            logger.mark('[Modrinth] 用户回复的是详情页消息，忽略g指令')
            return true  // 不做任何回复
        }

        // 检查是否有资源URL
        if (!session.resourceUrls || session.resourceUrls.length === 0) {
            await e.reply('❌ 当前页面没有资源信息')
            return true
        }

        // 提取资源序号
        const match = e.msg.match(/^g(\d+)$/)
        if (!match) {
            await e.reply('❌ 无效的序号')
            return true
        }

        const index = parseInt(match[1]) - 1  // 转换为数组索引（0-based）
        if (index < 0 || index >= session.resourceUrls.length) {
            await e.reply(`❌ 序号超出范围，当前页只有 ${session.resourceUrls.length} 个资源`)
            return true
        }

        const resourceUrl = session.resourceUrls[index]
        const resourceName = session.resourceNames?.[index] || '资源详情页'
        logger.mark(`[Modrinth] 查看详情: ${resourceName} - ${resourceUrl}`)

        try {
            // 发送加载提示
            await e.reply(`🔍 正在加载资源详情...`)

            // 截图详情页
            const screenshot = await takeDetailScreenshot(resourceUrl)

            // 发送截图
            const tempFile = this.saveTempImage(screenshot)
            const detailResult = await e.reply([
                `【Modrinth】${resourceName}`,
                segment.image(tempFile)
            ])

            // 记录详情页消息ID到会话中
            if (detailResult?.message_id) {
                if (!session.detailMessageIds) {
                    session.detailMessageIds = []
                }
                if (!session.detailMessageMap) {
                    session.detailMessageMap = {}
                }
                const msgIdStr = String(detailResult.message_id)
                session.detailMessageIds.push(msgIdStr)
                // 存储消息ID到资源信息的映射
                session.detailMessageMap[msgIdStr] = {
                    url: resourceUrl,
                    name: resourceName,
                    index: index
                }
                session.timestamp = Date.now()  // 刷新会话时间
                this.saveSession(e.user_id, session)
                logger.mark(`[Modrinth] 记录详情页消息ID: ${msgIdStr}`)
            }

            logger.mark('[Modrinth] 详情查看完成')

        } catch (err) {
            logger.error('[Modrinth] 详情查看失败:', err)
            await e.reply(`❌ 加载详情失败\n错误: ${err.message}`)
        }

        return true
    }

    /**
     * 查看版本页
     */
    async viewVersions(e) {
        logger.mark('[Modrinth] 收到版本页查看请求')
        logger.mark(`[Modrinth] 用户ID: ${e.user_id}`)
        logger.mark(`[Modrinth] 回复的消息ID: ${e.reply_id}`)

        // 检查是否回复了详情页消息
        if (!e.reply_id) {
            await e.reply('❌ 请回复详情页消息来查看版本列表')
            return true
        }

        // 检查会话是否存在
        const session = this.getSession(e.user_id)
        if (!session) {
            await e.reply(config.messages.sessionExpired)
            return true
        }

        // 调试日志
        logger.mark(`[Modrinth] 会话中的详情页消息IDs: ${JSON.stringify(session.detailMessageIds)}`)
        logger.mark(`[Modrinth] detailMessageMap: ${JSON.stringify(Object.keys(session.detailMessageMap || {}))}`)

        // 检查是否回复的是详情页消息（转换为字符串比较）
        const replyIdStr = String(e.reply_id)
        const detailIds = (session.detailMessageIds || []).map(id => String(id))

        if (!detailIds.includes(replyIdStr)) {
            await e.reply('❌ 请回复详情页消息来查看版本列表')
            return true
        }

        // 从 detailMessageMap 中获取资源信息（使用字符串key）
        const resourceInfo = session.detailMessageMap?.[replyIdStr]
        if (!resourceInfo) {
            await e.reply('❌ 无法找到对应的资源信息')
            return true
        }

        const resourceUrl = resourceInfo.url
        const resourceName = resourceInfo.name

        logger.mark(`[Modrinth] 查看版本: ${resourceName} - ${resourceUrl}`)

        try {
            await e.reply(`🔍 正在通过 API 加载版本列表...`)

            // 从 URL 提取项目 ID
            const projectId = extractProjectIdFromUrl(resourceUrl)
            logger.mark(`[Modrinth] 提取到项目 ID: ${projectId}`)

            // 使用 API 获取格式化的版本列表
            const versionList = await getProjectVersionsFormatted(projectId)
            logger.mark(`[Modrinth] 获取到 ${versionList.length} 个版本`)

            // 发送版本信息合并转发消息（第一页，前20个）
            const pageSize = 20
            const page1Versions = versionList.slice(0, pageSize)

            if (page1Versions.length > 0) {
                const forwardRes = await this.sendVersionsForward(e, page1Versions, resourceName)

                // 保存版本页信息到会话
                session.currentVersionUrl = resourceUrl  // 保存原始 URL
                session.currentProjectId = projectId     // 保存项目 ID
                session.currentVersionPage = 1
                session.currentVersionName = resourceName
                session.versionList = page1Versions      // 保存当前页版本列表
                session.allVersions = versionList        // 保存所有版本供翻页使用
                session.versionPageSize = pageSize

                if (!session.versionMessageIds) {
                    session.versionMessageIds = []
                }
                if (forwardRes?.message_id) {
                    session.versionMessageIds.push(forwardRes.message_id)
                }

                session.timestamp = Date.now()
                this.saveSession(e.user_id, session)

                // 提示用户如何翻页
                if (versionList.length > pageSize) {
                    await e.reply(`📄 共 ${versionList.length} 个版本，当前显示第 1-${page1Versions.length} 个\n💡 回复 v2、v3... 查看更多版本`)
                }
            } else {
                await e.reply('❌ 该资源暂无版本')
            }

            logger.mark('[Modrinth] 版本页查看完成')

        } catch (err) {
            logger.error('[Modrinth] 版本页查看失败:', err)
            await e.reply(`❌ 加载版本列表失败\n错误: ${err.message}`)
        }

        return true
    }

    /**
     * 版本页翻页
     */
    async paginateVersions(e) {
        logger.mark('[Modrinth] 收到版本页翻页请求')

        if (!e.reply_id) {
            return true
        }

        const session = this.getSession(e.user_id)
        if (!session || !session.allVersions) {
            return true
        }

        // 检查是否回复的是版本页消息
        if (!session.versionMessageIds || !session.versionMessageIds.map(id => String(id)).includes(String(e.reply_id))) {
            return true
        }

        const match = e.msg.match(/^v(\d+)$/)
        if (!match) {
            return true
        }

        const page = parseInt(match[1])
        if (page < 1) {
            return true
        }

        logger.mark(`[Modrinth] 版本页翻页到第 ${page} 页`)

        try {
            const pageSize = session.versionPageSize || 20
            const allVersions = session.allVersions
            const totalPages = Math.ceil(allVersions.length / pageSize)

            if (page > totalPages) {
                await e.reply(`❌ 页码超出范围，总共只有 ${totalPages} 页`)
                return true
            }

            // 客户端分页
            const startIndex = (page - 1) * pageSize
            const endIndex = Math.min(startIndex + pageSize, allVersions.length)
            const pageVersions = allVersions.slice(startIndex, endIndex)

            await e.reply(`🔍 正在加载第${page}页...`)

            const forwardRes = await this.sendVersionsForward(e, pageVersions, session.currentVersionName)
            if (forwardRes?.message_id) {
                session.versionMessageIds.push(forwardRes.message_id)
            }

            session.currentVersionPage = page
            session.versionList = pageVersions // 更新当前页版本列表
            session.timestamp = Date.now()
            this.saveSession(e.user_id, session)

            // 提示翻页信息
            await e.reply(`📄 第 ${page}/${totalPages} 页 (${startIndex + 1}-${endIndex}/${allVersions.length})`)

            logger.mark('[Modrinth] 版本页翻页完成')

        } catch (err) {
            logger.error('[Modrinth] 版本页翻页失败:', err)
            await e.reply(`❌ 翻页失败\n错误: ${err.message}`)
        }

        return true
    }

    /**
     * 下载版本文件
     */
    async downloadVersion(e) {
        logger.mark('[Modrinth] 收到下载请求')

        // 检查是否回复了消息
        if (!e.reply_id) {
            return true
        }

        const session = this.getSession(e.user_id)
        // 检查是否回复的是版本页消息
        const isValidReply = session.versionMessageIds && session.versionMessageIds.map(String).includes(String(e.reply_id))

        logger.mark(`[Modrinth] Debug: reply_id=${e.reply_id}, allIds=${JSON.stringify(session.versionMessageIds)}, isValid=${isValidReply}`)

        if (!isValidReply) {
            // 如果不是回复版本消息，提示用户
            await e.reply(`❌ 请回复版本列表消息进行下载`)
            return true
        }

        const match = e.msg.match(/^d(\d+)$/)
        if (!match) {
            return true
        }

        const index = parseInt(match[1]) - 1
        if (index < 0 || index >= session.versionList.length) {
            await e.reply(`❌ 序号超出范围，当前页只有 ${session.versionList.length} 个版本`)
            return true
        }

        const version = session.versionList[index]
        logger.mark(`[Modrinth] 版本信息: ${JSON.stringify(version)}`)

        // 从 API 数据的 files 数组中提取下载链接
        if (!version.files || version.files.length === 0) {
            await e.reply(`❌ 该版本没有可下载的文件`)
            return true
        }

        // 优先选择 primary 文件，否则选择第一个
        const file = version.files.find(f => f.primary) || version.files[0]
        const downloadUrl = file.url
        const fileName = file.filename

        logger.mark(`[Modrinth] 准备下载: ${version.name}`)
        logger.mark(`[Modrinth] 文件名: ${fileName}`)
        logger.mark(`[Modrinth] 下载链接: ${downloadUrl}`)

        await e.reply(`⏳ 正在下载文件: ${fileName}...`)

        let tempFilePath = null

        try {
            // 创建临时目录
            const tempDir = path.join(process.cwd(), 'temp', 'modrinth')
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true })
            }

            // 下载文件
            tempFilePath = path.join(tempDir, fileName)

            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(tempFilePath)
                https.get(downloadUrl, (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`下载失败，状态码: ${response.statusCode}`))
                        return
                    }
                    response.pipe(file)
                    file.on('finish', () => {
                        file.close()
                        resolve()
                    })
                }).on('error', (err) => {
                    fs.unlink(tempFilePath, () => { })
                    reject(err)
                })
            })

            logger.mark(`[Modrinth] 文件下载完成: ${tempFilePath}`)
            await e.reply('📤 正在上传文件...')

            // 发送文件
            // 尝试使用 group.sendFile (如果是群聊)
            if (e.isGroup && e.group.sendFile) {
                await e.group.sendFile(tempFilePath)
            } else {
                // 私聊或不支持 sendFile，尝试用 segment.file (可能不支持)
                // 或者提示用户
                await e.reply([
                    segment.image(path.join(process.cwd(), 'resources/common/face/v2/0.jpg')), // 占位
                    `文件已下载到服务器，但当前环境不支持直接发送文件。\n路径: ${tempFilePath}`
                ])
            }

        } catch (err) {
            logger.error('[Modrinth] 下载失败:', err)
            await e.reply(`❌ 下载失败: ${err.message}`)
        } finally {
            // 清理临时文件 (延迟删除，确保发送完成)
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                setTimeout(() => {
                    fs.unlink(tempFilePath, (err) => {
                        if (err) logger.error(`[Modrinth] 删除临时文件失败: ${err}`)
                        else logger.mark(`[Modrinth] 已清理临时文件: ${tempFilePath}`)
                    })
                }, 60000) // 1分钟后删除
            }
        }

        return true
    }
    async sendVersionsForward(e, versionList, resourceName) {
        try {
            const forwardMsgs = versionList.map((version, index) => ({
                message: `${index + 1}.\n【版本状态】: ${version.status}\n【模组版本】: ${version.name}\n【游戏版本】: ${version.gameVersion}\n【支持平台】: ${version.platforms}\n【发布时间】: ${version.published || 'Unknown'}\n【下载次数】: ${version.downloads || 'Unknown'}`,
                nickname: Bot.nickname,
                user_id: Bot.uin
            }))

            // 添加版本代号说明
            forwardMsgs.unshift({
                message: '【版本代号】\nR = 正式版本\nB = 测试版本\nA = 开发板本',
                nickname: Bot.nickname,
                user_id: Bot.uin
            })

            const res = await e.reply(await Bot.makeForwardMsg(forwardMsgs))
            logger.mark(`[Modrinth] 发送了 ${versionList.length} 个版本信息`)
            return res
        } catch (err) {
            logger.warn('[Modrinth] 发送合并转发消息失败:', err.message)
            return null
        }
    }

    /**
     * 映射分类（中英文 → 标准英文路径）
     */
    mapCategory(input) {
        const normalized = input.toLowerCase().trim()
        return config.categoryMap[normalized] || null
    }

    /**
     * 构建搜索 URL
     */
    buildSearchUrl(category, query, page = 1) {
        const encodedQuery = encodeURIComponent(query)
        // 根据分类获取显示数量
        const limit = config.categoryLimits[category] || 5

        // 使用 m 参数控制每页显示数量
        let url = `${config.baseUrl}/${category}?q=${encodedQuery}&m=${limit}`

        // 分页使用 page 参数（如果是第2页及以后）
        if (page > 1) {
            url += `&page=${page}`
        }

        return url
    }

    /**
     * 保存用户会话
     */
    saveSession(userId, sessionData) {
        userSessions.set(String(userId), sessionData)
        logger.mark(`[Modrinth] 保存会话: 用户 ${userId}`)
    }

    /**
     * 获取用户会话（检查超时）
     */
    getSession(userId) {
        const session = userSessions.get(String(userId))
        if (!session) {
            return null
        }

        // 检查是否超时
        const now = Date.now()
        if (now - session.timestamp > config.pagination.sessionTimeout) {
            logger.mark(`[Modrinth] 会话超时: 用户 ${userId}`)
            userSessions.delete(String(userId))
            return null
        }

        return session
    }

    /**
     * 刷新会话时间
     */
    refreshSession(userId) {
        const session = userSessions.get(String(userId))
        if (session) {
            session.timestamp = Date.now()
            logger.mark(`[Modrinth] 刷新会话时间: 用户 ${userId}`)
        }
    }

    /**
     * 撤回上一次的消息（翻页时使用）
     */
    async recallPreviousMessages(e, session) {
        try {
            const now = Date.now()
            const twoMinutes = 2 * 60 * 1000

            // 检查bot是否为管理员
            const isAdmin = e.group?.is_admin || e.group?.is_owner || false

            // 撤回上一次的搜索结果
            if (session.messageId) {
                const canRecall = isAdmin || (now - session.timestamp < twoMinutes)
                if (canRecall) {
                    try {
                        if (e.group?.recallMsg) {
                            await e.group.recallMsg(session.messageId)
                            logger.mark(`[Modrinth] 已撤回上一次的搜索结果`)
                        }
                    } catch (err) {
                        logger.warn(`[Modrinth] 撤回搜索结果失败:`, err.message)
                    }
                } else {
                    logger.mark(`[Modrinth] 搜索结果超时2分钟且bot非管理员，跳过撤回`)
                }
            }

            // 撤回上一次的提示消息（如果有）
            if (session.promptMessageId) {
                const canRecall = isAdmin || (now - session.timestamp < twoMinutes)
                if (canRecall) {
                    try {
                        if (e.group?.recallMsg) {
                            await e.group.recallMsg(session.promptMessageId)
                            logger.mark(`[Modrinth] 已撤回上一次的提示消息`)
                        }
                    } catch (err) {
                        logger.warn(`[Modrinth] 撤回提示消息失败:`, err.message)
                    }
                } else {
                    logger.mark(`[Modrinth] 提示消息超时2分钟且bot非管理员，跳过撤回`)
                }
            }

            // 撤回用户的翻页指令（如果用户不是管理员/群主）
            try {
                // 检查用户是否是管理员或群主
                const member = e.group?.pickMember ? await e.group.pickMember(e.user_id) : null
                const userIsAdmin = member?.is_admin || member?.is_owner || false

                if (!userIsAdmin && e.message_id) {
                    // 用户不是管理员，可以尝试撤回其消息
                    const canRecall = isAdmin || (now - session.timestamp < twoMinutes)
                    if (canRecall) {
                        if (e.group?.recallMsg) {
                            await e.group.recallMsg(e.message_id)
                            logger.mark(`[Modrinth] 已撤回用户的翻页指令`)
                        }
                    } else {
                        logger.mark(`[Modrinth] 用户翻页指令超时2分钟且bot非管理员，跳过撤回`)
                    }
                } else if (userIsAdmin) {
                    logger.mark(`[Modrinth] 用户是管理员/群主，跳过撤回其翻页指令`)
                }
            } catch (err) {
                logger.warn(`[Modrinth] 撤回用户翻页指令失败:`, err.message)
            }
        } catch (err) {
            logger.error('[Modrinth] 撤回消息失败:', err)
        }
    }

    /**
     * 映射分类（中英文 → 标准英文路径）
     */
    mapCategory(input) {
        const normalized = input.toLowerCase().trim()
        return config.categoryMap[normalized] || null
    }

    /**
     * 构建搜索 URL
     */
    buildSearchUrl(category, query, page = 1) {
        const encodedQuery = encodeURIComponent(query)
        // 根据分类获取显示数量
        const limit = config.categoryLimits[category] || 5

        // 使用 m 参数控制每页显示数量
        let url = `${config.baseUrl}/${category}?q=${encodedQuery}&m=${limit}`

        // 分页使用 page 参数（如果是第2页及以后）
        if (page > 1) {
            url += `&page=${page}`
        }

        return url
    }

    /**
     * 保存用户会话
     */
    saveSession(userId, sessionData) {
        userSessions.set(String(userId), sessionData)
        logger.mark(`[Modrinth] 保存会话: 用户 ${userId}`)
    }

    /**
     * 获取用户会话（检查超时）
     */
    getSession(userId) {
        const session = userSessions.get(String(userId))
        if (!session) {
            return null
        }

        // 检查是否超时
        const now = Date.now()
        if (now - session.timestamp > config.pagination.sessionTimeout) {
            logger.mark(`[Modrinth] 会话超时: 用户 ${userId}`)
            userSessions.delete(String(userId))
            return null
        }

        return session
    }

    /**
     * 刷新会话时间
     */
    refreshSession(userId) {
        const session = userSessions.get(String(userId))
        if (session) {
            session.timestamp = Date.now()
            logger.mark(`[Modrinth] 刷新会话时间: 用户 ${userId}`)
        }
    }
}

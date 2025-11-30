import config from './config.js'

/**
 * 使用 Puppeteer 截图搜索页
 */
export async function takeScreenshot(url, category = '') {
    let browser = null
    let page = null

    try {
        logger.mark('[Modrinth] 启动浏览器...')
        const puppeteer = (await import('puppeteer')).default

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        })

        page = await browser.newPage()
        await page.setViewport(config.puppeteer.viewport)
        page.setDefaultTimeout(config.puppeteer.timeout)

        logger.mark(`[Modrinth] 访问页面: ${url}`)
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: config.puppeteer.timeout
        })

        logger.mark('[Modrinth] 等待搜索结果加载...')
        await new Promise(resolve => setTimeout(resolve, config.puppeteer.waitForResults))

        // 对于特定分类，点击UI切换视图
        const needsUIClick = ['mods', 'modpacks', 'plugins', 'datapacks'].includes(category)
        if (needsUIClick) {
            try {
                logger.mark(`[Modrinth] 检测到 ${category} 分类，执行UI点击...`)
                const clickX = 1323 + 13
                const clickY = 194 + 13
                await page.mouse.click(clickX, clickY)
                logger.mark('[Modrinth] 第一次点击完成')
                await new Promise(resolve => setTimeout(resolve, 500))
                await page.mouse.click(clickX, clickY)
                logger.mark('[Modrinth] 第二次点击完成')
                await new Promise(resolve => setTimeout(resolve, 3000))
                logger.mark('[Modrinth] UI切换完成')
            } catch (e) {
                logger.warn('[Modrinth] UI点击失败，继续截图:', e.message)
            }
        } else {
            await new Promise(resolve => setTimeout(resolve, 2000))
        }

        logger.mark('[Modrinth] 开始截图...')
        const screenshot = await page.screenshot(config.puppeteer.screenshot)
        logger.mark(`[Modrinth] 截图完成，大小: ${screenshot.length} 字节`)

        // 提取资源名称列表和URL，带重试逻辑
        logger.mark('[Modrinth] 提取资源信息...')
        let resourceNames = []
        let resourceUrls = []
        let retryCount = 0
        const maxRetries = 2

        while (retryCount <= maxRetries) {
            const resourceData = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('a[href*="/mod/"], a[href*="/shader/"], a[href*="/resourcepack/"], a[href*="/datapack/"], a[href*="/modpack/"], a[href*="/plugin/"]'))
                const names = []
                const urls = []

                for (const card of cards) {
                    const titleElement = card.querySelector('h2, h3, [class*="title"], [class*="name"]')
                    if (titleElement && titleElement.textContent.trim()) {
                        names.push(titleElement.textContent.trim())
                        const href = card.getAttribute('href')
                        if (href) {
                            const fullUrl = href.startsWith('http') ? href : `https://modrinth.com${href}`
                            urls.push(fullUrl)
                        }
                    }
                }

                return { names, urls }
            })

            resourceNames = resourceData.names
            resourceUrls = resourceData.urls

            // 如果提取到资源，或者已经重试了最大次数，跳出循环
            if (resourceNames.length > 0 || retryCount >= maxRetries) {
                break
            }

            // 提取到0个资源，刷新页面重试
            retryCount++
            logger.warn(`[Modrinth] 提取到 0 个资源，刷新页面重试 (第${retryCount}/${maxRetries}次)...`)
            await page.reload({ waitUntil: 'domcontentloaded' })
            await new Promise(resolve => setTimeout(resolve, 3000)) // 等待页面加载
        }

        logger.mark(`[Modrinth] 提取到 ${resourceNames.length} 个资源名称和URL`)

        // 如果重试后仍然没有资源，抛出错误
        if (resourceNames.length === 0) {
            throw new Error('刷新页面2次后仍无法提取到资源信息，请稍后重试')
        }

        return { screenshot, resourceNames, resourceUrls }

    } catch (err) {
        logger.error('[Modrinth] 截图失败:', err)
        throw new Error(`浏览器操作失败: ${err.message}`)
    } finally {
        if (page) {
            try {
                await page.close()
            } catch (e) {
                logger.warn('[Modrinth] 关闭页面失败:', e)
            }
        }
        if (browser) {
            try {
                await browser.close()
            } catch (e) {
                logger.warn('[Modrinth] 关闭浏览器失败:', e)
            }
        }
    }
}

/**
 * 截图资源详情页
 */
export async function takeDetailScreenshot(url) {
    let browser = null
    let page = null

    try {
        logger.mark('[Modrinth] 启动浏览器...')
        const puppeteer = (await import('puppeteer')).default

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        })

        page = await browser.newPage()
        await page.setViewport(config.puppeteer.viewport)
        page.setDefaultTimeout(config.puppeteer.timeout)

        logger.mark(`[Modrinth] 访问详情页: ${url}`)
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: config.puppeteer.timeout
        })

        await new Promise(resolve => setTimeout(resolve, 5000))

        logger.mark('[Modrinth] 开始截图详情页...')
        const screenshot = await page.screenshot({
            ...config.puppeteer.screenshot,
            clip: {
                x: 649,
                y: 77,
                width: 1248,
                height: 1362
            }
        })

        logger.mark(`[Modrinth] 详情页截图完成，大小: ${screenshot.length} 字节`)
        return screenshot

    } catch (err) {
        logger.error('[Modrinth] 详情页截图失败:', err)
        throw new Error(`浏览器操作失败: ${err.message}`)
    } finally {
        if (page) {
            try {
                await page.close()
            } catch (e) {
                logger.warn('[Modrinth] 关闭页面失败:', e)
            }
        }
        if (browser) {
            try {
                await browser.close()
            } catch (e) {
                logger.warn('[Modrinth] 关闭浏览器失败:', e)
            }
        }
    }
}

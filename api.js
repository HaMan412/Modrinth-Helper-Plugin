import https from 'https'
import http from 'http'
import fs from 'fs'

const BASE_URL = 'https://api.modrinth.com/v2'

/**
 * 发送 HTTP 请求
 */
function request(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http

        protocol.get(url, {
            headers: {
                'User-Agent': 'Yunzai-Modrinth-Plugin/1.0'
            }
        }, (res) => {
            let data = ''

            res.on('data', chunk => {
                data += chunk
            })

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data))
                    } catch (e) {
                        reject(new Error(`JSON 解析失败: ${e.message}`))
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`))
                }
            })
        }).on('error', reject)
    })
}

/**
 * 搜索项目
 */
export async function searchProjects(query, facets = '', limit = 20, offset = 0) {
    try {
        const params = new URLSearchParams({
            query,
            limit: limit.toString(),
            offset: offset.toString()
        })

        if (facets) {
            params.append('facets', facets)
        }

        const url = `${BASE_URL}/search?${params.toString()}`
        console.log(`[Modrinth API] 搜索: ${url}`)

        const result = await request(url)
        return result
    } catch (err) {
        console.error('[Modrinth API] 搜索失败:', err)
        throw err
    }
}

/**
 * 获取项目详情
 */
export async function getProject(id) {
    try {
        const url = `${BASE_URL}/project/${id}`
        console.log(`[Modrinth API] 获取项目详情: ${url}`)

        const result = await request(url)
        return result
    } catch (err) {
        console.error('[Modrinth API] 获取项目详情失败:', err)
        throw err
    }
}

/**
 * 获取项目版本列表
 */
export async function getProjectVersions(id, filters = {}) {
    try {
        const params = new URLSearchParams()

        if (filters.loaders) {
            params.append('loaders', JSON.stringify(filters.loaders))
        }
        if (filters.game_versions) {
            params.append('game_versions', JSON.stringify(filters.game_versions))
        }
        if (filters.featured !== undefined) {
            params.append('featured', filters.featured.toString())
        }

        const queryString = params.toString()
        const url = `${BASE_URL}/project/${id}/version${queryString ? '?' + queryString : ''}`
        console.log(`[Modrinth API] 获取版本列表: ${url}`)

        const result = await request(url)
        return result
    } catch (err) {
        console.error('[Modrinth API] 获取版本列表失败:', err)
        throw err
    }
}

/**
 * 获取版本详情
 */
export async function getVersion(versionId) {
    try {
        const url = `${BASE_URL}/version/${versionId}`
        console.log(`[Modrinth API] 获取版本详情: ${url}`)

        const result = await request(url)
        return result
    } catch (err) {
        console.error('[Modrinth API] 获取版本详情失败:', err)
        throw err
    }
}

/**
 * 下载文件
 */
export function downloadFile(downloadUrl, filePath) {
    return new Promise((resolve, reject) => {
        const protocol = downloadUrl.startsWith('https') ? https : http
        const file = fs.createWriteStream(filePath)

        protocol.get(downloadUrl, {
            headers: {
                'User-Agent': 'Yunzai-Modrinth-Plugin/1.0'
            }
        }, (response) => {
            response.pipe(file)

            file.on('finish', () => {
                file.close()
                resolve(filePath)
            })
        }).on('error', (err) => {
            fs.unlink(filePath, () => { })
            reject(err)
        })
    })
}

/**
 * 从 URL 中提取项目 ID 或 slug
 * 支持格式：
 * - https://modrinth.com/mod/sodium
 * - https://modrinth.com/mod/sodium/versions
 */
export function extractProjectIdFromUrl(url) {
    try {
        const urlObj = new URL(url)
        const pathParts = urlObj.pathname.split('/').filter(p => p)

        // 路径格式：["mod", "sodium"] 或 ["mod", "sodium", "versions"]
        if (pathParts.length >= 2) {
            return pathParts[1] // 返回项目 slug
        }

        throw new Error('无法从 URL 提取项目 ID')
    } catch (err) {
        console.error('[Modrinth API] 提取项目 ID 失败:', err)
        throw err
    }
}

/**
 * 格式化时间差
 * 将 ISO 时间戳转换为 "X days ago" 格式
 */
function formatTimeAgo(isoDate) {
    try {
        const now = new Date()
        const published = new Date(isoDate)
        const diffMs = now - published

        const seconds = Math.floor(diffMs / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)
        const weeks = Math.floor(days / 7)
        const months = Math.floor(days / 30)
        const years = Math.floor(days / 365)

        if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`
        if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`
        if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`
        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
        return `${seconds} second${seconds > 1 ? 's' : ''} ago`
    } catch (err) {
        return 'Unknown'
    }
}

/**
 * 格式化下载量
 * 将数字转换为 "12.3k" 格式
 */
function formatDownloads(downloads) {
    if (downloads >= 1000000000) {
        return (downloads / 1000000000).toFixed(1) + 'B'
    }
    if (downloads >= 1000000) {
        return (downloads / 1000000).toFixed(1) + 'M'
    }
    if (downloads >= 1000) {
        return (downloads / 1000).toFixed(1) + 'k'
    }
    return downloads.toString()
}

/**
 * 获取并格式化项目版本列表
 * 返回与 Puppeteer 提取结构一致的数据
 */
export async function getProjectVersionsFormatted(projectId) {
    try {
        const versions = await getProjectVersions(projectId)

        const formatted = versions.map(version => {
            // 版本类型映射
            let status = 'R'
            if (version.version_type === 'beta') status = 'B'
            else if (version.version_type === 'alpha') status = 'A'

            // 游戏版本（取最新的一个）
            const gameVersion = version.game_versions && version.game_versions.length > 0
                ? version.game_versions[version.game_versions.length - 1]
                : 'Unknown'

            // 平台/加载器
            const platforms = version.loaders && version.loaders.length > 0
                ? version.loaders.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ')
                : 'Unknown'

            // 构建版本详情 URL
            // 需要从 project_id 构建，但我们暂时使用 version.id
            const detailUrl = `https://modrinth.com/mod/${projectId}/version/${version.id}`

            return {
                name: version.name || version.version_number,
                gameVersion,
                platforms,
                detailUrl,
                status,
                published: formatTimeAgo(version.date_published),
                downloads: formatDownloads(version.downloads),
                versionId: version.id,
                files: version.files || []
            }
        })

        console.log(`[Modrinth API] 格式化了 ${formatted.length} 个版本`)
        return formatted
    } catch (err) {
        console.error('[Modrinth API] 格式化版本列表失败:', err)
        throw err
    }
}

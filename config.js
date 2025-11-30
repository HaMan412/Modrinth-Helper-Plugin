/**
 * Modrinth 资源搜索插件配置
 */

export default {
    // 分类映射表：中文 → 英文路径
    categoryMap: {
        // 中文映射
        '模组': 'mods',
        '资源包': 'resourcepacks',
        '数据包': 'datapacks',
        '光影': 'shaders',
        '整合包': 'modpacks',
        '插件': 'plugins',

        // 英文映射（允许用户直接使用英文）
        'mods': 'mods',
        'mod': 'mods',
        'resourcepacks': 'resourcepacks',
        'resourcepack': 'resourcepacks',
        'resource packs': 'resourcepacks',
        'resource pack': 'resourcepacks',
        'datapacks': 'datapacks',
        'datapack': 'datapacks',
        'data packs': 'datapacks',
        'data pack': 'datapacks',
        'shaders': 'shaders',
        'shader': 'shaders',
        'modpacks': 'modpacks',
        'modpack': 'modpacks',
        'plugins': 'plugins',
        'plugin': 'plugins'
    },

    // 分类的中文显示名称
    categoryDisplayNames: {
        'mods': '模组',
        'resourcepacks': '资源包',
        'datapacks': '数据包',
        'shaders': '光影',
        'modpacks': '整合包',
        'plugins': '插件'
    },

    // 分类显示数量
    categoryLimits: {
        'mods': 5,
        'shaders': 6,
        'resourcepacks': 6,
        'datapacks': 5,
        'modpacks': 5,
        'plugins': 5
    },

    // Modrinth 基础 URL
    baseUrl: 'https://modrinth.com',

    // 分页配置
    pagination: {
        // 会话超时时间（毫秒）
        sessionTimeout: 5 * 60 * 1000 // 5分钟
    },

    // Puppeteer 配置
    puppeteer: {
        // 页面加载超时时间（毫秒）
        timeout: 30000,

        // 等待搜索结果加载的时间（毫秒）
        waitForResults: 5000,

        // 浏览器窗口大小
        viewport: {
            width: 2560,
            height: 1440
        },

        // 截图配置
        screenshot: {
            type: 'png',
            fullPage: false,  // 不截取整个页面
            encoding: 'binary',
            clip: {
                x: 964,      // 精确左上角 X 坐标
                y: 119,      // 精确左上角 Y 坐标
                width: 929,  // 精确宽度
                height: 1330 // 精确高度
            }
        }
    },

    // 错误消息配置
    messages: {
        invalidCategory: '❌ 无效的分类！\n\n支持的分类：\n• 模组 (mods)\n• 资源包 (resourcepacks)\n• 数据包 (datapacks)\n• 光影 (shaders)\n• 整合包 (modpacks)\n• 插件 (plugins)\n\n用法: /mr [分类] [搜索内容]',
        emptySearch: '❌ 请输入搜索内容！\n用法: /mr [分类] [搜索内容]',
        searchFailed: '❌ 搜索失败，请稍后重试',
        loading: '🔍 正在搜索 Modrinth...',
        pageLoading: '📄 正在加载第 {page} 页...',
        sessionExpired: '❌ 搜索会话已过期，请重新搜索',
        invalidPage: '❌ 无效的页码',
        noReplyContext: '❌ 请回复机器人的搜索结果消息来翻页'
    }
}

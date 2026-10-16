# 图片保存和联网补图

查询与详情采集只取得高德图片 URL。Excel 导出默认不下载图片；明确传非空 `photoPoiIds`，或模板映射本地图片字段时才保存相应高德原图。

只有用户明确要求“联网补图”时调用 `download_images`。按 `selectionId` 或 `poiIds` 限定范围，不给无关点位补图。原图保持原字节，不裁剪、不缩放；数量不足时报告失败原因。

百度使用安装包内置 Playwright Chromium，不依赖用户安装 Chrome。一个批次共用浏览器，搜索间隔默认 8 秒。`awaiting_user` 表示需要用户在打开的浏览器中完成安全验证；不能代替用户处理验证码，也不要启动重复任务。浏览器完成候选提取后仍需等待整体 operation 完成。

比例和尺寸是搜索条件。`portrait` 对应百度竖图分类，不保证精确 3:4；精确宽高需同时传 `width` 和 `height`，不符合的原图会跳过。`minWidth/minHeight` 是本地校验条件。

必应通过 HTTP 搜索，不启动浏览器。下载最多使用有限并发；仍应检查 `imageResults` 中每个点位的 requested、saved 和 failures。图片路径与来源可映射为 `originalPhotos`、`downloadedPhotos`、`imageSources`。

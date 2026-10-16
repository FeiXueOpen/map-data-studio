# 景区内部点位和范围采集

先 `get_status` 并在已加载点位中核对名称、城市和地址，不要为找一个父点重新查询清空现有数据。同名时使用 ID。

调用 `request_area_selection`，默认不传 `manual`。软件优先请求高德 AOI 边界，成功后自动分页搜索范围内点位并采集详情。用 `get_operation` 或 `get_status.areaSelection` 等待相同 requestId：`resolving_boundary`、`collecting` 都未完成；只有 `awaiting_user` 时才请用户至少选择 3 个顶点并双击闭合。

完成后通过 `list_pois({parentId})` 核对内部点位。AOI 范围关联不是高德官方父子关系，范围搜索也受接口上限限制，不能声称取得地图上的全部点位。

导出子点时，`get_template_gaps` 和 `export_excel_template` 都传相同的 `parentId` 与 `childrenOnly:true`；必要时再用 `poiIds` 限定。手动补录点没有高德 ID，会自动进入手动画范围兜底。

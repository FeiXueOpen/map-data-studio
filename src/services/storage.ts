import {backend} from './amap'
export type StorageSettings={excelDirectory:string;imageDirectory:string;resourceDirectory:string;browserProxy:string}
export const getStorageSettings=()=>backend<{settings:StorageSettings;defaults:StorageSettings;warning?:string}>('get_storage_settings')
export const saveStorageSettings=(settings:StorageSettings)=>backend<void>('save_storage_settings',{settings})

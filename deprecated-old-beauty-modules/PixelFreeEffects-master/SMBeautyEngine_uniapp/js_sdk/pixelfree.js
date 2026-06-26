/**
 * PixelFree 美颜 SDK UniApp 插件
 * 参考 Flutter 版本实现
 */

// 美颜类型枚举
export const PFBeautyFiterType = {
  // 大眼（默认0.0，关闭）
  eyeStrength: 0,
  // 瘦脸（默认0.0，关闭）
  faceThinning: 1,
  // 窄脸（默认0.0，关闭）
  faceNarrow: 2,
  // 下巴（默认0.5，两个方向调节）
  faceChin: 3,
  // V脸（默认0.0，关闭）
  faceV: 4,
  // 小脸（默认0.0，关闭）
  faceSmall: 5,
  // 鼻子（默认0.0，关闭）
  faceNose: 6,
  // 额头（默认0.5，两个方向调节）
  faceForehead: 7,
  // 嘴巴（默认0.5，两个方向调节）
  faceMouth: 8,
  // 人中（默认0.5，两个方向调节）
  facePhiltrum: 9,
  // 长鼻（默认0.5，两个方向调节）
  faceLongNose: 10,
  // 眼距（默认0.5，两个方向调节）
  faceEyeSpace: 11,
  // 微笑嘴角（默认0.0，关闭）
  faceSmile: 12,
  // 旋转眼睛（默认0.5，两个方向调节）
  faceEyeRotate: 13,
  // 开眼角（默认0.0，关闭）
  faceCanthus: 14,
  // 磨皮（默认0.0，关闭）
  faceBlurStrength: 15,
  // 美白（默认0.0，关闭）
  faceWhitenStrength: 16,
  // 红润（默认0.0，关闭）
  faceRuddyStrength: 17,
  // 锐化（默认0.0，关闭）
  faceSharpenStrength: 18,
  // 新美白算法（默认0.0，关闭）
  faceNewWhitenStrength: 19,
  // 画质增强（默认0.0，关闭）
  faceQualityStrength: 20,
  // 亮眼（默认0.0，关闭）
  faceEyeBrighten: 21,
  // 滤镜类型（默认origin，原图）
  filterName: 22,
  // 滤镜强度（默认0.0，关闭）
  filterStrength: 23,
  // 绿幕（默认关闭）
  lvmu: 24,
  // 2D贴纸（默认关闭）
  sticker2DFilter: 25,
  // 一键美颜（默认关闭）
  typeOneKey: 26,
  // 水印（默认关闭）
  watermark: 27,
  // 扩展字段
  extend: 28,
  // 祛法令纹（默认0.0，关闭）
  nasolabial: 29,
  // 祛黑眼圈（默认0.0，关闭）
  blackEye: 30,
  // 美牙（默认0.0，关闭）
  whitenTeeth: 31,
};

// 检测模式枚举
export const PFFaceDetectMode = {
  image: 0,  // 图片模式
  video: 1,  // 视频模式
};

/**
 * PixelFree 主类
 */
class PixelFree {
  constructor() {
    this.module = uni.requireNativePlugin('PixelFreeModule');
    if (!this.module) {
      console.error('PixelFreeModule not found. Please ensure the native plugin is properly configured.');
    }
  }

  /**
   * 初始化 PixelFree
   * @param {string} licPath 授权文件路径
   * @returns {Promise<void>}
   */
  async createWithLic(licPath) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    try {
      await this.module.createWithLic(licPath);
    } catch (error) {
      console.error('Failed to initialize PixelFree:', error);
      throw error;
    }
  }

  /**
   * 检查是否已初始化
   * @returns {Promise<boolean>}
   */
  async isCreate() {
    if (!this.module) {
      return false;
    }
    try {
      return await this.module.isCreate();
    } catch (error) {
      console.error('Failed to check initialization status:', error);
      return false;
    }
  }

  /**
   * 设置美颜参数
   * @param {number} type 美颜类型 (使用 PFBeautyFiterType 枚举)
   * @param {number} value 参数值 (0.0-1.0)
   * @returns {Promise<void>}
   */
  async pixelFreeSetBeautyFilterParam(type, value) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    if (value < 0 || value > 1.0) {
      throw new Error('Value must be between 0.0 and 1.0');
    }
    try {
      await this.module.pixelFreeSetBeautyFilterParam(type, value);
    } catch (error) {
      console.error('Failed to set beauty filter param:', error);
      throw error;
    }
  }

  /**
   * 设置滤镜参数
   * @param {string} filterName 滤镜名称
   * @param {number} value 滤镜强度 (0.0-1.0)
   * @returns {Promise<void>}
   */
  async pixelFreeSetFilterParam(filterName, value) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    if (value < 0 || value > 1.0) {
      throw new Error('Value must be between 0.0 and 1.0');
    }
    try {
      await this.module.pixelFreeSetFilterParam(filterName, value);
    } catch (error) {
      console.error('Failed to set filter param:', error);
      throw error;
    }
  }

  /**
   * 设置美颜扩展参数
   * @param {number} type 美颜类型
   * @param {string} value 扩展值
   * @returns {Promise<void>}
   */
  async pixelFreeSetBeautyExtend(type, value) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    try {
      await this.module.pixelFreeSetBeautyExtend(type, value);
    } catch (error) {
      console.error('Failed to set beauty extend:', error);
      throw error;
    }
  }

  /**
   * 设置2D贴纸
   * @param {string} filterName 贴纸名称
   * @returns {Promise<void>}
   */
  async pixelFreeSetSticker2DFilter(filterName) {
    return this.pixelFreeSetBeautyExtend(PFBeautyFiterType.sticker2DFilter, filterName);
  }

  /**
   * 设置美颜类型参数
   * @param {number} type 美颜类型
   * @param {number} value 参数值
   * @returns {Promise<void>}
   */
  async pixelFreeSetBeautyTypeParam(type, value) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    try {
      await this.module.pixelFreeSetBeautyTypeParam(type, value);
    } catch (error) {
      console.error('Failed to set beauty type param:', error);
      throw error;
    }
  }

  /**
   * 处理图片数据
   * @param {Uint8Array|ArrayBuffer} imageData 图片数据 (RGBA格式)
   * @param {number} width 宽度
   * @param {number} height 高度
   * @returns {Promise<Uint8Array>} 处理后的RGBA字节数组
   */
  async processWithImage(imageData, width, height) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    try {
      // 转换为数组格式（UniApp 原生插件需要）
      let dataArray;
      if (imageData instanceof Uint8Array) {
        dataArray = Array.from(imageData);
      } else if (imageData instanceof ArrayBuffer) {
        dataArray = Array.from(new Uint8Array(imageData));
      } else if (Array.isArray(imageData)) {
        dataArray = imageData;
      } else {
        throw new Error('Invalid image data format');
      }
      
      console.log(`[PixelFree] Calling processWithImage: input size=${dataArray.length}, width=${width}, height=${height}`);
      
      let result;
      try {
        // 注意：如果原生方法使用 UNI_EXPORT_METHOD_SYNC，这是同步调用，不需要 await
        // 但为了兼容性，仍然使用 await（如果方法实际是异步的）
        result = this.module.processWithImage(dataArray, width, height);
        console.log(`[PixelFree] Method call completed, result type: ${typeof result}`);
      } catch (callError) {
        console.error(`[PixelFree] Method call failed:`, callError);
        throw new Error(`调用原生方法失败: ${callError.message || callError}`);
      }
      
      // 详细检查返回结果
      console.log(`[PixelFree] Received result: type=${typeof result}, isArray=${Array.isArray(result)}, isNull=${result === null}, isUndefined=${result === undefined}`);
      
      if (result === null || result === undefined) {
        console.error(`[PixelFree] Result is null or undefined`);
        throw new Error('处理失败：原生方法返回 null 或 undefined');
      }
      
      // iOS 返回的是 Base64 字符串
      if (typeof result !== 'string') {
        console.error(`[PixelFree] Result is not a string, type: ${typeof result}`);
        throw new Error(`处理失败：返回类型错误，期望字符串，实际为 ${typeof result}`);
      }
      
      if (result.length === 0) {
        console.error(`[PixelFree] Result string is empty`);
        throw new Error('处理失败：返回的字符串为空');
      }
      
      console.log(`[PixelFree] Received base64 string, length=${result.length}`);
      
      // 转换为数据 URI
      const dataUri = `data:image/png;base64,${result}`;
      console.log(`[PixelFree] Converted to data URI, length=${dataUri.length}`);
      
      return dataUri;
    } catch (error) {
      console.error('Failed to process image:', error);
      throw error;
    }
  }
  
  /**
   * Base64 解码（降级方案）
   * @private
   */
  base64Decode(str) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    
    str = str.replace(/[^A-Za-z0-9\+\/\=]/g, '');
    
    for (let i = 0; i < str.length; i += 4) {
      const enc1 = chars.indexOf(str.charAt(i));
      const enc2 = chars.indexOf(str.charAt(i + 1));
      const enc3 = chars.indexOf(str.charAt(i + 2));
      const enc4 = chars.indexOf(str.charAt(i + 3));
      
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      
      output += String.fromCharCode(chr1);
      
      if (enc3 !== 64) {
        output += String.fromCharCode(chr2);
      }
      if (enc4 !== 64) {
        output += String.fromCharCode(chr3);
      }
    }
    
    return output;
  }
  
  /**
   * 将 RGBA 字节数组转换为 base64 图片
   * @param {Uint8Array} rgbaData RGBA 字节数组
   * @param {number} width 宽度
   * @param {number} height 高度
   * @returns {Promise<string>} base64 图片数据 URL
   */
  async rgbaToBase64(rgbaData, width, height) {
    return new Promise((resolve, reject) => {
      try {
        // 创建 canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // 创建 ImageData
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(rgbaData);
        
        // 绘制到 canvas
        ctx.putImageData(imageData, 0, 0);
        
        // 转换为 base64
        const base64 = canvas.toDataURL('image/png');
        resolve(base64);
      } catch (error) {
        // 如果浏览器环境不支持，使用 uni API
        if (typeof uni !== 'undefined') {
          // 在 UniApp 中，可以使用 uni.canvasToTempFilePath 或直接返回临时文件路径
          // 这里先返回一个占位符，实际使用时需要根据平台处理
          reject(new Error('UniApp 环境需要特殊处理，请使用 processWithImageToBase64 方法'));
        } else {
          reject(error);
        }
      }
    });
  }
  
  /**
   * 处理图片并返回 base64
   * @param {Uint8Array|ArrayBuffer} imageData 图片数据 (RGBA格式)
   * @param {number} width 宽度
   * @param {number} height 高度
   * @returns {Promise<string>} base64 图片数据 URL
   */
  async processWithImageToBase64(imageData, width, height) {
    const rgbaData = await this.processWithImage(imageData, width, height);
    return await this.rgbaToBase64(rgbaData, width, height);
  }

  /**
   * 处理纹理ID
   * @param {number} textureID 输入纹理ID
   * @param {number} width 宽度
   * @param {number} height 高度
   * @returns {Promise<number>} 处理后的纹理ID
   */
  async processWithTextureID(textureID, width, height) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    try {
      const resultTextureID = await this.module.processWithTextureID(textureID, width, height);
      return resultTextureID;
    } catch (error) {
      console.error('Failed to process texture:', error);
      throw error;
    }
  }

  /**
   * 设置检测模式
   * @param {number} mode 检测模式 (使用 PFFaceDetectMode 枚举)
   * @returns {Promise<void>}
   */
  async setDetectMode(mode) {
    if (!this.module) {
      throw new Error('PixelFreeModule not available');
    }
    try {
      await this.module.setDetectMode(mode);
    } catch (error) {
      console.error('Failed to set detect mode:', error);
      throw error;
    }
  }

  /**
   * 检查是否检测到人脸
   * @returns {Promise<boolean>}
   */
  async hasFace() {
    if (!this.module) {
      return false;
    }
    try {
      return await this.module.hasFace();
    } catch (error) {
      console.error('Failed to check face:', error);
      return false;
    }
  }

  /**
   * 获取人脸数量
   * @returns {Promise<number>}
   */
  async getFaceSize() {
    if (!this.module) {
      return 0;
    }
    try {
      return await this.module.getFaceSize();
    } catch (error) {
      console.error('Failed to get face size:', error);
      return 0;
    }
  }

  /**
   * 释放资源
   * @returns {Promise<void>}
   */
  async release() {
    if (!this.module) {
      return;
    }
    try {
      await this.module.release();
    } catch (error) {
      console.error('Failed to release PixelFree:', error);
      throw error;
    }
  }
}

// 导出单例
export default new PixelFree();

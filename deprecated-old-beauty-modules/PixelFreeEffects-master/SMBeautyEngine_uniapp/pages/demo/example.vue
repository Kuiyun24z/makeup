<template>
  <view class="container">
    <view class="content">
      <!-- 图片预览区域 - 放在上方 -->
      <view class="image-preview">
        <!-- 使用 canvas 显示处理后的图片 -->
        <canvas 
          v-if="processedImage && imageWidth > 0 && imageHeight > 0"
          canvas-id="previewCanvas"
          :style="canvasPreviewStyle"
          :width="canvasDisplaySize.width"
          :height="canvasDisplaySize.height"
          class="preview-canvas"
          :disable-scroll="true"
        ></canvas>
        <!-- 备用：使用 image 标签 -->
        <image 
          v-else-if="processedImage" 
          :src="processedImage" 
          mode="aspectFit" 
          class="preview-image"
          :key="imageKey"
          @error="onImageError"
          @load="onImageLoad"
          lazy-load="false"
        />
        <view v-else class="preview-placeholder">
          <text>加载中...</text>
        </view>
      </view>
      
      <!-- 美颜参数调节栏 - 放在下方 -->
      <view class="params-panel" v-if="isInitialized">
        <text class="panel-title">美颜参数调节</text>
        
        <view class="param-item">
          <text class="param-label">大眼: {{ beautyParams.eyeStrength }}</text>
          <slider 
            :value="beautyParams.eyeStrength * 100" 
            min="0" 
            max="100" 
            @change="onEyeStrengthChange"
            activeColor="#007AFF"
          />
        </view>
        
        <view class="param-item">
          <text class="param-label">瘦脸: {{ beautyParams.faceThinning }}</text>
          <slider 
            :value="beautyParams.faceThinning * 100" 
            min="0" 
            max="100" 
            @change="onFaceThinningChange"
            activeColor="#007AFF"
          />
        </view>
        
        <view class="param-item">
          <text class="param-label">磨皮: {{ beautyParams.faceBlurStrength }}</text>
          <slider 
            :value="beautyParams.faceBlurStrength * 100" 
            min="0" 
            max="100" 
            @change="onFaceBlurStrengthChange"
            activeColor="#007AFF"
          />
        </view>
        
        <view class="param-item">
          <text class="param-label">美白: {{ beautyParams.faceWhitenStrength }}</text>
          <slider 
            :value="beautyParams.faceWhitenStrength * 100" 
            min="0" 
            max="100" 
            @change="onFaceWhitenStrengthChange"
            activeColor="#007AFF"
          />
        </view>
        
        <view class="param-item">
          <text class="param-label">美牙: {{ beautyParams.whitenTeeth }}</text>
          <slider 
            :value="beautyParams.whitenTeeth * 100" 
            min="0" 
            max="100" 
            @change="onWhitenTeethChange"
            activeColor="#007AFF"
          />
        </view>
      </view>
      
      <canvas 
        canvas-id="imageCanvas" 
        :style="{ width: (canvasWidth || 720) + 'px', height: (canvasHeight || 1024) + 'px', position: 'fixed', left: '-9999px', top: '-9999px' }"
      ></canvas>
    </view>
  </view>
</template>

<script>
import PixelFree, { PFBeautyFiterType, PFFaceDetectMode } from '@/js_sdk/pixelfree.js';

export default {
  data() {
    return {
      isInitialized: false,
      isProcessing: false,
      processTimer: null,
      isConvertingToImage: false, // 防止并发转换
      isDrawingCanvas: false, // 防止并发绘制 canvas
      beautyParams: {
        eyeStrength: 0.5,
        faceThinning: 0.5,
        faceBlurStrength: 0.5,
        faceWhitenStrength: 0.5,
        whitenTeeth: 0.5,
      },
      processedImage: null,
      imageKey: 0, // 用于强制刷新图片
      originalImagePath: null,
      imageData: null,
      imageWidth: 0,
      imageHeight: 0,
      canvasWidth: 720,
      canvasHeight: 1024,
    };
  },
  
  computed: {
    // 计算 canvas 显示尺寸（长边充满）
    canvasDisplaySize() {
      if (!this.imageWidth || !this.imageHeight) {
        return { width: 0, height: 0 };
      }
      
      // 长边充满：让图片的长边充满容器，短边按比例缩放
      // 使用系统信息获取实际屏幕尺寸
      const systemInfo = uni.getSystemInfoSync();
      const containerWidth = systemInfo.windowWidth || 750;
      const containerHeight = Math.floor((systemInfo.windowHeight || 1334) * 0.5); // 50vh
      
      const imageRatio = this.imageWidth / this.imageHeight;
      const containerRatio = containerWidth / containerHeight;
      
      let displayWidth, displayHeight;
      
      if (imageRatio >= containerRatio) {
        // 图片更宽或比例相同，长边是宽度，让宽度充满
        displayWidth = containerWidth;
        displayHeight = containerWidth / imageRatio;
      } else {
        // 图片更高，长边是高度，让高度充满
        displayHeight = containerHeight;
        displayWidth = containerHeight * imageRatio;
      }
      
      console.log('[Canvas] 显示尺寸计算:', {
        imageSize: `${this.imageWidth}x${this.imageHeight}`,
        imageRatio: imageRatio.toFixed(2),
        containerSize: `${containerWidth}x${containerHeight}`,
        displaySize: `${Math.floor(displayWidth)}x${Math.floor(displayHeight)}`
      });
      
      return {
        width: Math.floor(displayWidth),
        height: Math.floor(displayHeight)
      };
    },
    
    // Canvas 预览样式（长边充满）
    canvasPreviewStyle() {
      const size = this.canvasDisplaySize;
      if (size.width === 0 || size.height === 0) {
        return {};
      }
      
      // 使用计算出的显示尺寸，确保长边充满
      return {
        width: size.width + 'px',
        height: size.height + 'px',
        maxWidth: '100%',
        maxHeight: '50vh',
        // 确保 canvas 正确显示
        display: 'block',
        margin: '0 auto'
      };
    }
  },
  
  onLoad() {
    // 自动初始化并加载默认图片
    this.initPixelFree();
  },
  
  onUnload() {
    this.stopTimer();
    if (this.isInitialized) {
      PixelFree.release().catch(err => {
        console.error('释放资源失败:', err);
      });
    }
  },
  
  methods: {
    async initPixelFree() {
      try {
        uni.showLoading({
          title: '初始化中...',
        });
        
        // 先加载默认图片路径
        await this.loadDefaultImagePath();
        
        // 初始化 - 需要根据实际路径调整
        const licPath = '/static/pixelfreeAuth.lic';
        await PixelFree.createWithLic(licPath);
        
        // 设置检测模式为图片模式
        await PixelFree.setDetectMode(PFFaceDetectMode.image);
        
        // 设置初始美颜参数
        await this.setBeautyParams();
        
        this.isInitialized = true;
        
        // 加载默认图片数据
        if (this.originalImagePath) {
          await this.loadDefaultImageData();
          // 立即处理一次
          this.processImageOnce();
          // 启动定时器，每0.1秒处理一次
          this.startTimer();
        }
        
        uni.hideLoading();
      } catch (error) {
        uni.hideLoading();
        console.error('初始化失败:', error);
        // 即使初始化失败，也尝试显示原图
        if (this.originalImagePath) {
          this.processedImage = this.originalImagePath;
        }
      }
    },
    
    // 加载默认图片路径
    async loadDefaultImagePath() {
      // 尝试多个可能的路径
      const possiblePaths = [
        '/static/IMG_2406.png',
        '@/static/IMG_2406.png',
        '/src/main/assets/IMG_2406.png',
        '@/src/main/assets/IMG_2406.png',
        'static/IMG_2406.png',
        'src/main/assets/IMG_2406.png',
      ];
      
      let imagePath = null;
      let imageInfo = null;
      
      for (const path of possiblePaths) {
        try {
          imageInfo = await uni.getImageInfo({ src: path });
          imagePath = path;
          console.log('找到图片路径:', path);
          break;
        } catch (e) {
          console.log('尝试路径失败:', path, e);
          continue;
        }
      }
      
        if (imageInfo && imagePath) {
          // 使用 imageInfo.path（完整路径）而不是相对路径
          this.originalImagePath = imageInfo.path || imagePath;
          this.processedImage = imageInfo.path || imagePath; // 先显示原图
          this.imageWidth = imageInfo.width;
          this.imageHeight = imageInfo.height;
          this.canvasWidth = imageInfo.width;
          this.canvasHeight = imageInfo.height;
          console.log('原图路径加载成功:', this.originalImagePath, imageInfo);
        } else {
        console.warn('无法找到图片文件 IMG_2406.png');
        // 使用第一个路径作为备用
        const fallbackPath = possiblePaths[0];
        this.originalImagePath = fallbackPath;
        this.processedImage = fallbackPath;
        console.log('使用备用路径:', fallbackPath);
      }
    },
    
    // 加载默认图片数据（只加载一次，用于定时器处理）
    async loadDefaultImageData() {
      if (!this.originalImagePath) {
        return;
      }
      
      try {
        console.log('开始加载默认图片数据:', this.originalImagePath);
        
        // 获取图片信息
        const imageInfo = await uni.getImageInfo({
          src: this.originalImagePath,
        });
        
        this.imageWidth = imageInfo.width;
        this.imageHeight = imageInfo.height;
        this.canvasWidth = imageInfo.width;
        this.canvasHeight = imageInfo.height;
        
        // 将图片转换为 RGBA 数据（只转换一次，后续复用）
        this.imageData = await this.getImageDataFromPath(this.originalImagePath);
        
        if (!this.imageData || this.imageData.length === 0) {
          console.warn('获取图片数据失败');
          // 显示原图
          this.processedImage = this.originalImagePath;
        } else {
          console.log('图片数据加载成功，准备开始定时处理');
          // 先显示原图
          this.processedImage = this.originalImagePath;
        }
      } catch (error) {
        console.error('加载默认图片数据失败:', error);
        // 失败时显示原图
        if (this.originalImagePath) {
          this.processedImage = this.originalImagePath;
        }
      }
    },
    
    // 启动定时器
    startTimer() {
      if (!this.imageData || this.imageWidth === 0 || this.imageHeight === 0) {
        console.warn('图片数据未加载，无法启动定时器');
        return;
      }
      
      if (this.processTimer) {
        console.warn('定时器已在运行');
        return;
      }
      
      this.isProcessing = true;
      console.log('启动定时器，每0.1秒处理一次图片');
      
      // 立即处理一次
      this.processImageOnce();
      
      // 设置定时器，每0.1秒（100ms）处理一次
      this.processTimer = setInterval(() => {
        this.processImageOnce();
      }, 100);
    },
    
    // 停止定时器
    stopTimer() {
      this.isProcessing = false;
      if (this.processTimer) {
        clearInterval(this.processTimer);
        this.processTimer = null;
        console.log('定时器已停止');
      }
    },
    
    // 处理单帧图片（定时器调用）
    async processImageOnce() {
      if (!this.isInitialized || !this.imageData || this.imageWidth === 0 || this.imageHeight === 0) {
        return;
      }
      
      // 如果正在转换，跳过本次（避免并发冲突）
      if (this.isConvertingToImage) {
        return;
      }
      
      try {
        console.log('processImageOnce: 开始处理图片');
        
        // 处理图片，返回 RGBA 字节数组（iOS返回base64，已解码为Uint8Array）
        const rgbaData = await PixelFree.processWithImage(
          this.imageData,
          this.imageWidth,
          this.imageHeight
        );
        
        console.log('processImageOnce: processWithImage 完成, 返回数据 URI');
        
        // 直接将 Base64 数据 URI 绘制到 canvas
        if (rgbaData && typeof rgbaData === 'string' && rgbaData.startsWith('data:image/')) {
          // 如果正在绘制，等待一小段时间后重试（避免闪烁，但确保最终会更新）
          if (this.isDrawingCanvas) {
            console.log('[Canvas] 跳过绘制：正在绘制中，将在下次定时器触发时更新');
            return;
          }
          
          try {
            this.isDrawingCanvas = true;
            
            const displaySize = this.canvasDisplaySize;
            console.log('[Canvas] 准备绘制处理后的图片:', {
              imageSize: `${this.imageWidth}x${this.imageHeight}`,
              displaySize: `${displaySize.width}x${displaySize.height}`,
              dataUriLength: rgbaData.length,
              dataUriPrefix: rgbaData.substring(0, 50)
            });
            
            // 绘制到预览 canvas，确保每次处理后的结果都会更新
            await this.drawBase64ToCanvas(rgbaData, 'previewCanvas');
            
            // 只在第一次设置 processedImage（用于控制 canvas 的显示）
            if (!this.processedImage) {
              this.processedImage = rgbaData;
              console.log('[Canvas] 首次设置 processedImage');
            }
            
            console.log('[Canvas] 绘制流程完成，图片已更新到屏幕');
          } catch (drawError) {
            console.error('[Canvas] 绘制到 canvas 失败:', drawError);
          } finally {
            this.isDrawingCanvas = false;
          }
        } else {
          console.warn('[Canvas] 返回的数据无效:', rgbaData ? rgbaData.substring(0, 50) : 'null');
        }
      } catch (error) {
        console.error('processImageOnce: 处理失败:', error);
        this.isConvertingToImage = false;
      }
    },
    
    async setBeautyParams() {
      if (!this.isInitialized) {
        uni.showToast({
          title: '请先初始化',
          icon: 'none',
        });
        return;
      }
      
      try {
        // 设置所有美颜参数
        await PixelFree.pixelFreeSetBeautyFilterParam(
          PFBeautyFiterType.eyeStrength,
          this.beautyParams.eyeStrength
        );
        await PixelFree.pixelFreeSetBeautyFilterParam(
          PFBeautyFiterType.faceThinning,
          this.beautyParams.faceThinning
        );
        await PixelFree.pixelFreeSetBeautyFilterParam(
          PFBeautyFiterType.faceBlurStrength,
          this.beautyParams.faceBlurStrength
        );
        await PixelFree.pixelFreeSetBeautyFilterParam(
          PFBeautyFiterType.faceWhitenStrength,
          this.beautyParams.faceWhitenStrength
        );
        await PixelFree.pixelFreeSetBeautyFilterParam(
          PFBeautyFiterType.whitenTeeth,
          this.beautyParams.whitenTeeth
        );
        
        uni.showToast({
          title: '参数设置成功',
          icon: 'success',
        });
      } catch (error) {
        console.error('设置美颜参数失败:', error);
        uni.showToast({
          title: '设置失败',
          icon: 'none',
        });
      }
    },
    
    async processImage() {
      if (!this.isInitialized) {
        uni.showToast({
          title: '请先初始化',
          icon: 'none',
        });
        return;
      }
      
      try {
        // 选择图片
        const res = await uni.chooseImage({
          count: 1,
          sourceType: ['album', 'camera'],
        });
        
        if (!res.tempFilePaths || res.tempFilePaths.length === 0) {
          return;
        }
        
        const imagePath = res.tempFilePaths[0];
        
        // 获取图片信息
        const imageInfo = await uni.getImageInfo({
          src: imagePath,
        });
        
        uni.showLoading({
          title: '处理中...',
        });
        
        // 将图片转换为 RGBA 数据
        console.log('开始从路径获取 RGBA 数据, imagePath =', imagePath);
        const imageData = await this.getImageDataFromPath(imagePath);
        
        if (!imageData || imageData.length === 0) {
          uni.hideLoading();
          uni.showToast({
            title: '获取图片数据失败',
            icon: 'none',
          });
          return;
        }
        
        // 处理图片，返回 Base64 数据 URI
        console.log('开始调用 PixelFree.processWithImage, width =', imageInfo.width, 'height =', imageInfo.height, 'data length =', imageData.length);
        const processedImageDataUri = await PixelFree.processWithImage(
          imageData,
          imageInfo.width,
          imageInfo.height
        );
        console.log('PixelFree.processWithImage 调用完成, 返回数据 URI');
        
        // 直接使用返回的 Base64 数据 URI
        if (processedImageDataUri && typeof processedImageDataUri === 'string' && processedImageDataUri.startsWith('data:image/')) {
          this.processedImage = processedImageDataUri;
          console.log('设置 processedImage 为 Base64 数据 URI');
        } else {
          // 如果处理失败，显示原图
          this.processedImage = imagePath;
          console.log('处理失败, 回退显示原图路径:', this.processedImage);
        }
        
        uni.hideLoading();
        
        uni.showToast({
          title: '处理完成',
          icon: 'success',
        });
      } catch (error) {
        uni.hideLoading();
        console.error('处理图片失败:', error);
        uni.showToast({
          title: '处理失败: ' + error.message,
          icon: 'none',
          duration: 3000,
        });
      }
    },
    
    async checkFace() {
      if (!this.isInitialized) {
        uni.showToast({
          title: '请先初始化',
          icon: 'none',
        });
        return;
      }
      
      try {
        const hasFace = await PixelFree.hasFace();
        const faceSize = await PixelFree.getFaceSize();
        
        uni.showModal({
          title: '人脸检测结果',
          content: `检测到人脸: ${hasFace ? '是' : '否'}\n人脸数量: ${faceSize}`,
          showCancel: false,
        });
      } catch (error) {
        console.error('检测人脸失败:', error);
        uni.showToast({
          title: '检测失败',
          icon: 'none',
        });
      }
    },
    
    onEyeStrengthChange(e) {
      this.beautyParams.eyeStrength = e.detail.value / 100;
      this.updateBeautyParam(PFBeautyFiterType.eyeStrength, this.beautyParams.eyeStrength);
    },
    
    onFaceThinningChange(e) {
      this.beautyParams.faceThinning = e.detail.value / 100;
      this.updateBeautyParam(PFBeautyFiterType.faceThinning, this.beautyParams.faceThinning);
    },
    
    onFaceBlurStrengthChange(e) {
      this.beautyParams.faceBlurStrength = e.detail.value / 100;
      this.updateBeautyParam(PFBeautyFiterType.faceBlurStrength, this.beautyParams.faceBlurStrength);
    },
    
    onFaceWhitenStrengthChange(e) {
      this.beautyParams.faceWhitenStrength = e.detail.value / 100;
      this.updateBeautyParam(PFBeautyFiterType.faceWhitenStrength, this.beautyParams.faceWhitenStrength);
    },
    
    onWhitenTeethChange(e) {
      this.beautyParams.whitenTeeth = e.detail.value / 100;
      this.updateBeautyParam(PFBeautyFiterType.whitenTeeth, this.beautyParams.whitenTeeth);
    },
    
    async updateBeautyParam(type, value) {
      if (!this.isInitialized) {
        return;
      }
      
      try {
        // 设置参数
        await PixelFree.pixelFreeSetBeautyFilterParam(type, value);
        console.log(`[BeautyParam] 参数已更新: type=${type}, value=${value}`);
        
        // 参数更新后，立即触发一次处理，让用户立即看到效果
        // 确保参数设置完成后再处理图片
        if (this.imageData && this.imageWidth > 0 && this.imageHeight > 0) {
          // 使用 nextTick 确保参数设置完成，然后立即处理
          this.$nextTick(() => {
            // 如果定时器正在运行，立即处理一次（不等待定时器）
            if (this.processTimer) {
              this.processImageOnce().catch(err => {
                console.error('[BeautyParam] 立即处理失败:', err);
              });
            }
          });
        }
      } catch (error) {
        console.error('更新美颜参数失败:', error);
      }
    },
    
    async getImageDataFromPath(imagePath) {
      return new Promise((resolve, reject) => {
        // 使用 canvas 读取图片并转换为 RGBA 数据
        const ctx = uni.createCanvasContext('imageCanvas', this);
        
        // 获取图片信息
        uni.getImageInfo({
          src: imagePath,
          success: (imageInfo) => {
            this.canvasWidth = imageInfo.width;
            this.canvasHeight = imageInfo.height;
            
            // 绘制图片到 canvas
            ctx.drawImage(imagePath, 0, 0, imageInfo.width, imageInfo.height);
            ctx.draw(false, () => {
              // 获取 canvas 像素数据
              uni.canvasGetImageData({
                canvasId: 'imageCanvas',
                x: 0,
                y: 0,
                width: imageInfo.width,
                height: imageInfo.height,
                success: (res) => {
                  // res.data 是 Uint8ClampedArray，包含 RGBA 数据
                  // 转换为 Uint8Array
                  const rgbaData = new Uint8Array(res.data);
                  resolve(rgbaData);
                },
                fail: reject,
              }, this);
            });
          },
          fail: reject,
        });
      });
    },
    
    // 将 Base64 数据 URI 绘制到 canvas（优化：减少闪烁）
    async drawBase64ToCanvas(dataUri, canvasId) {
      return new Promise((resolve, reject) => {
        try {
          const ctx = uni.createCanvasContext(canvasId, this);
          const displaySize = this.canvasDisplaySize;
          
          // 使用显示尺寸绘制，确保绘制和显示尺寸一致
          const drawWidth = displaySize.width || this.imageWidth || 720;
          const drawHeight = displaySize.height || this.imageHeight || 1024;
          
          console.log('[Canvas] 开始绘制:', {
            canvasId,
            drawSize: `${drawWidth}x${drawHeight}`,
            imageSize: `${this.imageWidth}x${this.imageHeight}`,
            displaySize: `${displaySize.width}x${displaySize.height}`,
            dataUriLength: dataUri ? dataUri.length : 0,
            dataUriPrefix: dataUri ? dataUri.substring(0, 30) : 'null'
          });
          
          // 清空 canvas（确保干净绘制）
          ctx.clearRect(0, 0, drawWidth, drawHeight);
          
          // 绘制 Base64 图片，使用显示尺寸（drawImage 会自动缩放）
          ctx.drawImage(dataUri, 0, 0, drawWidth, drawHeight);
          
          // 执行绘制
          ctx.draw(false, () => {
            console.log('[Canvas] 绘制完成:', {
              canvasId,
              drawSize: `${drawWidth}x${drawHeight}`,
              displaySize: `${displaySize.width}x${displaySize.height}`
            });
            resolve();
          });
        } catch (error) {
          console.error('[Canvas] 绘制失败:', error);
          reject(error);
        }
      });
    },
    
    // 将 Base64 数据转换为临时文件
    async base64ToTempFile(base64Data) {
      return new Promise((resolve, reject) => {
        try {
          // 方法1: 尝试使用 canvas 将 Base64 图片转换为临时文件
          const ctx = uni.createCanvasContext('imageCanvas', this);
          const dataUri = `data:image/png;base64,${base64Data}`;
          
          // 绘制 Base64 图片到 canvas
          ctx.drawImage(dataUri, 0, 0, this.imageWidth, this.imageHeight);
          ctx.draw(false, () => {
            // 将 canvas 转换为临时文件
            uni.canvasToTempFilePath({
              canvasId: 'imageCanvas',
              width: this.imageWidth,
              height: this.imageHeight,
              destWidth: this.imageWidth,
              destHeight: this.imageHeight,
              fileType: 'png',
              quality: 1,
              success: (res) => {
                const tempFilePath = res && res.tempFilePath;
                if (tempFilePath) {
                  console.log('base64ToTempFile: 转换成功, path=', tempFilePath);
                  resolve(tempFilePath);
                } else {
                  console.error('base64ToTempFile: canvasToTempFilePath 返回空路径');
                  reject(new Error('canvasToTempFilePath returned empty path'));
                }
              },
              fail: (err) => {
                console.error('base64ToTempFile: canvasToTempFilePath 失败:', err);
                reject(err);
              }
            }, this);
          });
        } catch (error) {
          console.error('base64ToTempFile: 异常:', error);
          reject(error);
        }
      });
    },
    
    // 图片加载成功
    onImageLoad(e) {
      console.log('图片加载成功! processedImage type:', typeof this.processedImage, 'length:', this.processedImage ? this.processedImage.length : 0);
      console.log('图片加载成功, 前50个字符:', this.processedImage ? this.processedImage.substring(0, 50) : 'null');
      console.log('图片加载事件详情:', e);
      // 强制更新视图
      this.$nextTick(() => {
        this.$forceUpdate();
      });
    },
    
    // 图片加载失败
    onImageError(e) {
      console.error('图片加载失败:', this.processedImage, e);
      // 如果处理后的图片加载失败，尝试显示原图
      if (this.originalImagePath && this.processedImage !== this.originalImagePath) {
        console.log('回退到原图:', this.originalImagePath);
        this.processedImage = this.originalImagePath;
        this.$forceUpdate();
      }
    },
    
    // 将 RGBA 字节数组转换为图片（使用 base64 数据 URI）
    async rgbaToImage(rgbaData, width, height) {
      return new Promise((resolve, reject) => {
        try {
          // 确保数据格式正确（Uint8Array 或 Uint8ClampedArray）
          let dataArray = rgbaData;
          if (rgbaData instanceof Uint8Array) {
            // 转换为普通数组（UniApp canvas API 需要）
            dataArray = Array.from(rgbaData);
          } else if (rgbaData instanceof Uint8ClampedArray) {
            dataArray = Array.from(rgbaData);
          } else if (!Array.isArray(rgbaData)) {
            console.error('rgbaToImage: 无效的数据格式', typeof rgbaData);
            reject(new Error('Invalid data format'));
            return;
          }
          
          // 使用 canvas 将 RGBA 数据渲染为图片
          uni.canvasPutImageData({
            canvasId: 'imageCanvas',
            x: 0,
            y: 0,
            width: width,
            height: height,
            data: dataArray,
            success: () => {
              // 将 canvas 转换为临时文件，然后读取为 base64
              uni.canvasToTempFilePath({
                canvasId: 'imageCanvas',
                width: width,
                height: height,
                destWidth: width,
                destHeight: height,
                fileType: 'png',
                quality: 1,
                success: async (res) => {
                  const tempFilePath = res && res.tempFilePath;
                  if (tempFilePath) {
                    // 尝试读取文件并转换为 base64 数据 URI
                    try {
                      const fs = uni.getFileSystemManager();
                      // 读取文件（返回 ArrayBuffer）
                      const fileData = fs.readFileSync(tempFilePath);
                      // 将 ArrayBuffer 转换为 base64
                      let base64 = '';
                      if (fileData instanceof ArrayBuffer) {
                        const bytes = new Uint8Array(fileData);
                        // 使用 uni.arrayBufferToBase64（如果可用）
                        if (typeof uni !== 'undefined' && uni.arrayBufferToBase64) {
                          base64 = uni.arrayBufferToBase64(fileData);
                        } else {
                          // 降级方案：手动转换
                          const binary = String.fromCharCode.apply(null, Array.from(bytes));
                          // 使用全局 btoa 或 uni 的 base64 编码
                          if (typeof btoa !== 'undefined') {
                            base64 = btoa(binary);
                          } else {
                            throw new Error('btoa not available');
                          }
                        }
                      } else if (typeof fileData === 'string') {
                        // 如果已经是 base64 字符串
                        base64 = fileData;
                      } else {
                        throw new Error('Unsupported file data type');
                      }
                      const dataUri = `data:image/png;base64,${base64}`;
                      console.log('rgbaToImage 成功，使用 base64 数据 URI, length=', base64.length);
                      resolve(dataUri);
                    } catch (readError) {
                      console.warn('读取文件为 base64 失败，尝试使用文件路径:', readError);
                      // 如果读取失败，尝试转换路径格式
                      let finalPath = tempFilePath;
                      // 尝试使用 plus.io 转换路径（如果可用）
                      if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
                        try {
                          finalPath = plus.io.convertLocalFileSystemURL(tempFilePath);
                          console.log('路径转换成功:', finalPath);
                        } catch (convertError) {
                          console.warn('路径转换失败:', convertError);
                        }
                      }
                      // 确保路径格式正确（与原图路径格式一致）
                      // 如果路径不是以 file:// 开头，且不是 http/https/data，添加 file://
                      if (!finalPath.startsWith('file://') && !finalPath.startsWith('http://') && !finalPath.startsWith('https://') && !finalPath.startsWith('data:')) {
                        // 确保路径以 / 开头
                        if (!finalPath.startsWith('/')) {
                          finalPath = '/' + finalPath;
                        }
                        finalPath = 'file://' + finalPath;
                      }
                      console.log('rgbaToImage 成功，使用文件路径:', finalPath);
                      // 添加短暂延迟，确保文件写入完成
                      setTimeout(() => {
                        resolve(finalPath);
                      }, 50);
                    }
                  } else {
                    console.error('canvasToTempFilePath 返回空路径, res=', res);
                    reject(new Error('canvasToTempFilePath returned empty path'));
                  }
                },
                fail: (err) => {
                  console.error('canvasToTempFilePath 失败:', err);
                  reject(err);
                }
              }, this);
            },
            fail: (err) => {
              console.error('canvasPutImageData 失败:', err);
              reject(err);
            }
          }, this);
        } catch (error) {
          console.error('rgbaToImage 异常:', error);
          reject(error);
        }
      });
    },
  },
};
</script>

<style scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  display: flex;
  flex-direction: column;
}

.content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
}

.params-panel {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 15px;
  display: block;
}

.param-item {
  margin-bottom: 15px;
}

.param-label {
  font-size: 14px;
  color: #333333;
  margin-bottom: 8px;
  display: block;
}

.image-preview {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 15px;
  text-align: center;
  min-height: 300px;
  max-height: 50vh;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
  /* 确保内容不被裁剪 */
  overflow: visible;
  flex-shrink: 0;
  width: 100%;
  /* 允许内容超出容器 */
  position: relative;
}

.preview-image {
  width: 100%;
  max-width: 100%;
  max-height: 50vh;
  height: auto;
  min-height: 200px;
  border-radius: 8px;
  display: block;
  visibility: visible;
  opacity: 1;
  background-color: #f0f0f0;
}

.preview-canvas {
  border-radius: 8px;
  display: block;
  visibility: visible;
  opacity: 1;
  background-color: #f0f0f0;
  /* 确保 canvas 不被裁剪 */
  box-sizing: border-box;
  overflow: visible;
  /* 保持宽高比 */
  object-fit: contain;
}

.preview-placeholder {
  color: #999999;
  font-size: 14px;
}
</style>

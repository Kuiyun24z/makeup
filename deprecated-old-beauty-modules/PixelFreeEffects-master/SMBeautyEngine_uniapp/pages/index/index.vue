<template>
  <view class="container">
    <view class="header">
      <text class="title">PixelFree 美颜 SDK</text>
      <text class="subtitle">UniApp Demo</text>
    </view>
    
    <view class="content">
      <view class="info-card">
        <text class="info-title">📱 快速开始</text>
        <text class="info-text">点击下方按钮进入美颜示例页面</text>
      </view>
      
      <button class="primary-btn" @click="goToDemo">
        进入美颜示例
      </button>
      
      <view class="tips">
        <text class="tips-title">⚠️ 使用前请确保：</text>
        <text class="tips-item">1. 已添加授权文件到 static 目录</text>
        <text class="tips-item">2. 已配置原生插件</text>
        <text class="tips-item">3. 已添加模型文件</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  methods: {
    goToDemo() {
      uni.navigateTo({
        url: '/pages/demo/example'
      });
    }
  }
}
</script>

<style>
.container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40rpx;
}

.header {
  text-align: center;
  margin-top: 100rpx;
  margin-bottom: 80rpx;
}

.title {
  display: block;
  font-size: 48rpx;
  font-weight: bold;
  color: #ffffff;
  margin-bottom: 20rpx;
}

.subtitle {
  display: block;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.8);
}

.content {
  background-color: #ffffff;
  border-radius: 24rpx;
  padding: 40rpx;
  margin-top: 40rpx;
}

.info-card {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 40rpx;
}

.info-title {
  display: block;
  font-size: 32rpx;
  font-weight: bold;
  color: #333333;
  margin-bottom: 16rpx;
}

.info-text {
  display: block;
  font-size: 28rpx;
  color: #666666;
  line-height: 1.6;
}

.primary-btn {
  width: 100%;
  height: 88rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  border: none;
  border-radius: 44rpx;
  font-size: 32rpx;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 40rpx;
  box-shadow: 0 8rpx 24rpx rgba(102, 126, 234, 0.4);
}

.primary-btn:active {
  opacity: 0.8;
}

.tips {
  background-color: #fff3cd;
  border-left: 6rpx solid #ffc107;
  border-radius: 8rpx;
  padding: 24rpx;
}

.tips-title {
  display: block;
  font-size: 28rpx;
  font-weight: bold;
  color: #856404;
  margin-bottom: 16rpx;
}

.tips-item {
  display: block;
  font-size: 26rpx;
  color: #856404;
  line-height: 1.8;
  margin-bottom: 8rpx;
}
</style>

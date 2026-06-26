package io.dcloud.feature.pixelfree;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Log;

import com.hapi.pixelfree.PFBeautyFilterType;
import com.hapi.pixelfree.PFSrcType;
import com.hapi.pixelfree.PixelFree;
import com.hapi.pixelfree.PFImageInput;
import com.hapi.pixelfree.PFRotationMode;
import com.hapi.pixelfree.PFDetectFormat;
import com.hapi.pixelfree.PFFaceDetectMode;
import com.hapi.pixelfree.PFMakeupPart;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

import io.dcloud.feature.sdk.Interface.IUniModule;
import io.dcloud.feature.sdk.annotation.UniJSMethod;
import io.dcloud.feature.sdk.Interface.IUniSDKInstance;

public class PixelFreeModule implements IUniModule {
    private static final String TAG = "PixelFreeModule";
    private PixelFree mPixelFree;
    private Context mContext;
    private IUniSDKInstance mUniSDKInstance;

    @Override
    public void onActivityCreate() {
        if (mUniSDKInstance != null) {
            mContext = mUniSDKInstance.getContext();
        }
    }

    @Override
    public void onActivityDestroy() {
        if (mPixelFree != null) {
            mPixelFree.release();
            mPixelFree = null;
        }
    }

    @Override
    public void setUniSDKInstance(IUniSDKInstance instance) {
        this.mUniSDKInstance = instance;
        if (instance != null) {
            mContext = instance.getContext();
        }
    }

    /**
     * 初始化 PixelFree
     * @param licPath 授权文件路径
     */
    @UniJSMethod(uiThread = false)
    public void createWithLic(String licPath) {
        try {
            mPixelFree = new PixelFree();
            mPixelFree.create();
            
            byte[] bytes = loadBinaryFromPath(licPath);
            byte[] bytes2 = mPixelFree.readBundleFile(mContext, "filter_model.bundle");
            
            mPixelFree.auth(mContext, bytes, bytes.length);
            mPixelFree.createBeautyItemFormBundle(
                    bytes2,
                    bytes2.length,
                    PFSrcType.PFSrcTypeFilter
            );
            
            Log.d(TAG, "PixelFree initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize PixelFree", e);
            throw new RuntimeException("Failed to initialize PixelFree: " + e.getMessage());
        }
    }

    /**
     * 检查是否已初始化
     */
    @UniJSMethod(uiThread = false)
    public boolean isCreate() {
        return mPixelFree != null && mPixelFree.isCreate();
    }

    /**
     * 设置美颜参数
     * @param type 美颜类型索引
     * @param value 参数值 (0.0-1.0)
     */
    @UniJSMethod(uiThread = false)
    public void pixelFreeSetBeautyFilterParam(int type, double value) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        PFBeautyFilterType filterType = PFBeautyFilterType.values()[type];
        mPixelFree.pixelFreeSetBeautyFiterParam(filterType, (float) value);
    }

    /**
     * 设置滤镜参数
     * @param filterName 滤镜名称
     * @param value 滤镜强度 (0.0-1.0)
     */
    @UniJSMethod(uiThread = false)
    public void pixelFreeSetFilterParam(String filterName, double value) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        mPixelFree.pixelFreeSetFilterParam(filterName, (float) value);
    }

    /**
     * 设置美颜扩展参数
     * @param type 美颜类型索引
     * @param value 扩展值
     */
    @UniJSMethod(uiThread = false)
    public void pixelFreeSetBeautyExtend(int type, String value) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        PFBeautyFilterType filterType = PFBeautyFilterType.values()[type];
        mPixelFree.pixelFreeSetBeautyExtend(filterType, value);
    }

    /**
     * 设置美颜类型参数
     * @param type 美颜类型索引
     * @param value 参数值
     */
    @UniJSMethod(uiThread = false)
    public void pixelFreeSetBeautyTypeParam(int type, int value) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        mPixelFree.pixelFreeSetBeautyFiterParam(PFBeautyFilterType.PFBeautyFilterTypeOneKey, value);
    }

    /**
     * 处理图片数据
     * @param imageData 图片数据 (RGBA格式)
     * @param width 宽度
     * @param height 高度
     * @return 处理后的纹理ID
     */
    @UniJSMethod(uiThread = false)
    public int processWithImage(byte[] imageData, int width, int height) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        
        PFImageInput pxInput = new PFImageInput();
        pxInput.setWigth(width);
        pxInput.setHeight(height);
        pxInput.setStride_0(width * 4);
        pxInput.setStride_1(0);
        pxInput.setP_data0(imageData);
        pxInput.setFormat(PFDetectFormat.PFFORMAT_IMAGE_RGBA);
        pxInput.setRotationMode(PFRotationMode.PFRotationMode0);
        pxInput.setTextureID(0);
        
        mPixelFree.processWithBuffer(pxInput);
        return pxInput.getTextureID();
    }

    /**
     * 处理纹理ID
     * @param textureID 输入纹理ID
     * @param width 宽度
     * @param height 高度
     * @return 处理后的纹理ID
     */
    @UniJSMethod(uiThread = false)
    public int processWithTextureID(int textureID, int width, int height) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        
        PFImageInput pxInput = new PFImageInput();
        pxInput.setWigth(width);
        pxInput.setHeight(height);
        pxInput.setFormat(PFDetectFormat.PFFORMAT_IMAGE_TEXTURE);
        pxInput.setRotationMode(PFRotationMode.PFRotationMode0);
        pxInput.setTextureID(textureID);
        
        mPixelFree.processWithBuffer(pxInput);
        return pxInput.getTextureID();
    }

    /**
     * 设置检测模式
     * @param mode 0=IMAGE, 1=VIDEO
     */
    @UniJSMethod(uiThread = false)
    public void setDetectMode(int mode) {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            throw new RuntimeException("PixelFree not initialized");
        }
        PFFaceDetectMode detectMode = mode == 0 
            ? PFFaceDetectMode.PF_FACE_DETECT_MODE_IMAGE 
            : PFFaceDetectMode.PF_FACE_DETECT_MODE_VIDEO;
        mPixelFree.setDetectMode(detectMode);
    }

    /**
     * 检查是否检测到人脸
     */
    @UniJSMethod(uiThread = false)
    public boolean hasFace() {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            return false;
        }
        return mPixelFree.hasFace() != 0;
    }

    /**
     * 获取人脸数量
     */
    @UniJSMethod(uiThread = false)
    public int getFaceSize() {
        if (mPixelFree == null || !mPixelFree.isCreate()) {
            return 0;
        }
        return mPixelFree.getFaceCount();
    }

    /**
     * 释放资源
     */
    @UniJSMethod(uiThread = false)
    public void release() {
        if (mPixelFree != null) {
            mPixelFree.release();
            mPixelFree = null;
        }
    }

    /**
     * 从路径加载二进制文件
     */
    private byte[] loadBinaryFromPath(String filePath) throws IOException {
        File file = new File(filePath);
        FileInputStream fis = new FileInputStream(file);
        byte[] data = new byte[(int) file.length()];
        fis.read(data);
        fis.close();
        return data;
    }
}

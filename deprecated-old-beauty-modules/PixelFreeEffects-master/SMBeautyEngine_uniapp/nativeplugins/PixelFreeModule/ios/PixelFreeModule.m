#import "PixelFreeModule.h"
#import "SMPixelFree.h"
#import <UIKit/UIKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <dispatch/dispatch.h>

@interface PixelFreeModule ()
@property(nonatomic, strong) SMPixelFree *mPixelFree;
@end

@implementation PixelFreeModule

UNI_EXPORT_METHOD(@selector(createWithLic:))
UNI_EXPORT_METHOD(@selector(pixelFreeSetBeautyFilterParam:value:))
UNI_EXPORT_METHOD(@selector(pixelFreeSetFilterParam:value:))
UNI_EXPORT_METHOD(@selector(pixelFreeSetBeautyExtend:value:))
UNI_EXPORT_METHOD(@selector(pixelFreeSetBeautyTypeParam:value:))
UNI_EXPORT_METHOD_SYNC(@selector(processWithImage:width:height:))
UNI_EXPORT_METHOD(@selector(processWithTextureID:width:height:))
UNI_EXPORT_METHOD(@selector(setDetectMode:))
UNI_EXPORT_METHOD_SYNC(@selector(hasFace))
UNI_EXPORT_METHOD_SYNC(@selector(getFaceSize))


- (void)onCreateUniPlugin {
    NSLog(@"PixelFreeModule onCreateUniPlugin");
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    return YES;
}

/**
 * 初始化 PixelFree
 * @param licPath 授权文件路径
 */
- (void)createWithLic:(NSString *)licPath {
    NSString *face_FiltePath = [[NSBundle mainBundle] pathForResource:@"filter_model.bundle" ofType:nil];
    
    if (!face_FiltePath) {
        @throw [NSException exceptionWithName:@"InitializationError"
                                       reason:@"filter_model.bundle not found"
                                     userInfo:nil];
    }
    
    self.mPixelFree = [[SMPixelFree alloc] initWithProcessContext:nil
                                                    srcFilterPath:face_FiltePath
                                                         authFile:licPath];
    
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"InitializationError"
                                       reason:@"Failed to initialize PixelFree"
                                     userInfo:nil];
    }
}

/**
 * 检查是否已初始化
 */
- (BOOL)isCreate {
    return self.mPixelFree != nil;
}

/**
 * 设置美颜参数
 * @param type 美颜类型索引
 * @param value 参数值 (0.0-1.0)
 */
- (void)pixelFreeSetBeautyFilterParam:(NSNumber *)type value:(NSNumber *)value {
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"NotInitialized"
                                       reason:@"PixelFree not initialized"
                                     userInfo:nil];
    }
    
    int typeInt = [type intValue];
    float valueFloat = [value floatValue];
    
    [self.mPixelFree pixelFreeSetBeautyFilterParam:typeInt value:&valueFloat];
}

/**
 * 设置滤镜参数
 * @param filterName 滤镜名称
 * @param value 滤镜强度 (0.0-1.0)
 */
- (void)pixelFreeSetFilterParam:(NSString *)filterName value:(NSNumber *)value {
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"NotInitialized"
                                       reason:@"PixelFree not initialized"
                                     userInfo:nil];
    }
    
    float valueFloat = [value floatValue];
    const char *filterNameCStr = [filterName UTF8String];
    
    [self.mPixelFree pixelFreeSetBeautyFilterParam:PFBeautyFilterName value:(void *)filterNameCStr];
    [self.mPixelFree pixelFreeSetBeautyFilterParam:PFBeautyFilterStrength value:&valueFloat];
}

/**
 * 设置美颜扩展参数
 * @param type 美颜类型索引
 * @param value 扩展值
 */
- (void)pixelFreeSetBeautyExtend:(NSNumber *)type value:(NSString *)value {
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"NotInitialized"
                                       reason:@"PixelFree not initialized"
                                     userInfo:nil];
    }
    // iOS 端扩展参数设置可根据实际 SDK 接口调整
}

/**
 * 设置美颜类型参数
 * @param type 美颜类型索引
 * @param value 参数值
 */
- (void)pixelFreeSetBeautyTypeParam:(NSNumber *)type value:(NSNumber *)value {
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"NotInitialized"
                                       reason:@"PixelFree not initialized"
                                     userInfo:nil];
    }
    
    int valueInt = [value intValue];
    [self.mPixelFree pixelFreeSetBeautyFilterParam:PFBeautyFilterTypeOneKey value:&valueInt];
}

/**
 * 处理图片数据
 * @param imageData 图片数据 (RGBA格式)
 * @param width 宽度
 * @param height 高度
 * @return 处理后的RGBA数据的 base64 字符串（绕过 UniApp 大数组限制）
 */
- (NSString *)processWithImage:(NSArray *)imageData width:(NSNumber *)width height:(NSNumber *)height {
    @try {
        if (!self.mPixelFree) {
            NSLog(@"[PixelFree] ERROR: PixelFree not initialized");
            return @"";
        }
    
    NSDate *startTime = [NSDate date];
    int w = [width intValue];
    int h = [height intValue];
    
    NSLog(@"[PixelFree] processWithImage: input width=%d, height=%d, imageData count=%lu", w, h, (unsigned long)imageData.count);
    
    // 优化：批量将 NSArray 转换为字节数组
    NSUInteger dataCount = imageData.count;
    
    // 预分配足够大的 NSMutableData（包含输入和输出数据）
    // 输出大小 = width * height * 4 (RGBA)
    size_t outputSize = w * h * 4;
    NSMutableData *data = [NSMutableData dataWithLength:MAX(dataCount, outputSize)];
    uint8_t *bytes = (uint8_t *)data.mutableBytes;
    
    // 优化：使用 block 枚举，减少方法调用开销
    [imageData enumerateObjectsUsingBlock:^(NSNumber *byte, NSUInteger idx, BOOL *stop) {
        bytes[idx] = [byte unsignedCharValue];
    }];
    
    NSTimeInterval step1Time = [[NSDate date] timeIntervalSinceDate:startTime];
    NSLog(@"[PixelFree] Step1 - Converted to NSData: size=%lu bytes, time: %.3f seconds", 
          (unsigned long)data.length, step1Time);
    
    CVPixelBufferRef pixelBuffer = [self getRenderTargetWithWidth:w height:h rgbaBuffer:(char *)data.bytes];
    
    if (!pixelBuffer) {
        NSLog(@"[PixelFree] ERROR: Failed to create pixel buffer");
        return @"";
    }
    
    NSTimeInterval step2Time = [[NSDate date] timeIntervalSinceDate:startTime];
    NSLog(@"[PixelFree] Step2 - Created pixel buffer successfully, time: %.3f seconds", step2Time);
    
    // 处理图片
    NSDate *processStart = [NSDate date];
    [self.mPixelFree processWithBuffer:pixelBuffer rotationMode:PFRotationMode0];
    NSTimeInterval processTime = [[NSDate date] timeIntervalSinceDate:processStart];
    NSLog(@"[PixelFree] Step3 - PixelFree processWithBuffer, time: %.3f seconds", processTime);
    
    // 从处理后的 CVPixelBuffer 中提取 RGBA 字节数据
    CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    
    // 1. 获取 BGRA 数据的指针和大小
    uint8_t *baseAddress = (uint8_t *)CVPixelBufferGetBaseAddress(pixelBuffer);
    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
    size_t bufferHeight = CVPixelBufferGetHeight(pixelBuffer);
    size_t bufferWidth = CVPixelBufferGetWidth(pixelBuffer);
    
    NSLog(@"[PixelFree] PixelBuffer info: width=%zu, height=%zu, bytesPerRow=%zu", bufferWidth, bufferHeight, bytesPerRow);
    
    // 2. 直接使用 data.mutableBytes 作为输出缓冲区（避免额外分配）
    size_t rgbaBufferSize = bufferWidth * bufferHeight * 4;  // RGBA 占 4 字节
    NSLog(@"[PixelFree] Using shared memory buffer: size=%zu bytes (expected: %d * %d * 4 = %d)", 
          rgbaBufferSize, w, h, w * h * 4);
    
    // 确保 data 有足够空间
    if (data.length < rgbaBufferSize) {
        data.length = rgbaBufferSize;
    }
    
    uint8_t *rgbaBuffer = (uint8_t *)data.mutableBytes;  // 直接使用共享内存
    
    // 3. 优化：使用并行处理将 BGRA 转换为 RGBA（直接写入目标缓冲区）
    NSDate *convertStart = [NSDate date];
    NSUInteger pixelCount = bufferWidth * bufferHeight;
    
    // 使用 dispatch_apply 并行处理（对于大图片效果明显）
    if (pixelCount > 10000) {
        dispatch_apply(bufferHeight, dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^(size_t y) {
            uint8_t *srcRow = baseAddress + y * bytesPerRow;
            uint8_t *dstRow = rgbaBuffer + y * bufferWidth * 4;
            
            // 优化：使用指针操作，减少数组索引计算
            for (size_t x = 0; x < bufferWidth; x++) {
                size_t srcOffset = x * 4;
                size_t dstOffset = x * 4;
                // BGRA -> RGBA
                dstRow[dstOffset + 0] = srcRow[srcOffset + 2];  // R
                dstRow[dstOffset + 1] = srcRow[srcOffset + 1];  // G
                dstRow[dstOffset + 2] = srcRow[srcOffset + 0];  // B
                dstRow[dstOffset + 3] = srcRow[srcOffset + 3];  // A
            }
        });
    } else {
        // 小图片使用串行处理，优化循环
        for (size_t y = 0; y < bufferHeight; y++) {
            uint8_t *srcRow = baseAddress + y * bytesPerRow;
            uint8_t *dstRow = rgbaBuffer + y * bufferWidth * 4;
            
            // 优化：使用指针操作
            for (size_t x = 0; x < bufferWidth; x++) {
                size_t offset = x * 4;
                // BGRA -> RGBA
                dstRow[offset + 0] = srcRow[offset + 2];  // R
                dstRow[offset + 1] = srcRow[offset + 1];  // G
                dstRow[offset + 2] = srcRow[offset + 0];  // B
                dstRow[offset + 3] = srcRow[offset + 3];  // A
            }
        }
    }
    NSTimeInterval convertTime = [[NSDate date] timeIntervalSinceDate:convertStart];
    NSLog(@"[PixelFree] Step4 - BGRA to RGBA conversion (direct to shared memory), time: %.3f seconds", convertTime);
    // 释放资源
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    CVPixelBufferRelease(pixelBuffer);
    
    // 5. 将 RGBA 数据转换为 UIImage 并转换为 Base64
    NSDate *imageStart = [NSDate date];
    
    // 创建 CGImageRef 从 RGBA 数据
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(rgbaBuffer, bufferWidth, bufferHeight, 8, bufferWidth * 4, colorSpace, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    
    if (!context) {
        NSLog(@"[PixelFree] ERROR: Failed to create bitmap context");
        CGColorSpaceRelease(colorSpace);
        return @"";
    }
    
    CGImageRef cgImage = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    CGColorSpaceRelease(colorSpace);
    
    if (!cgImage) {
        NSLog(@"[PixelFree] ERROR: Failed to create CGImage");
        return @"";
    }
    
    // 创建 UIImage
    UIImage *processedImage = [UIImage imageWithCGImage:cgImage];
    CGImageRelease(cgImage);
    
    if (!processedImage) {
        NSLog(@"[PixelFree] ERROR: Failed to create UIImage");
        return @"";
    }
    
    // 转换为 PNG 数据
    NSData *pngData = UIImagePNGRepresentation(processedImage);
    if (!pngData) {
        NSLog(@"[PixelFree] ERROR: Failed to convert UIImage to PNG data");
        return @"";
    }
    
    // 转换为 Base64 字符串
    NSString *base64String = [pngData base64EncodedStringWithOptions:0];
    if (!base64String) {
        NSLog(@"[PixelFree] ERROR: Failed to encode PNG data to base64");
        return @"";
    }
    
    NSTimeInterval imageTime = [[NSDate date] timeIntervalSinceDate:imageStart];
    NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:startTime];
    NSLog(@"[PixelFree] Step5 - Converted to Base64: size=%lu bytes, time: %.3f seconds, total: %.3f seconds", 
          (unsigned long)base64String.length, imageTime, elapsed);
    
    // 返回 Base64 字符串
    return base64String;
    
    } @catch (NSException *exception) {
        NSLog(@"[PixelFree] EXCEPTION in processWithImage: %@, reason: %@", exception.name, exception.reason);
        return @"";
    }
}

/**
 * 处理纹理ID
 * @param textureID 输入纹理ID
 * @param width 宽度
 * @param height 高度
 * @return 处理后的纹理ID
 */
- (NSNumber *)processWithTextureID:(NSNumber *)textureID width:(NSNumber *)width height:(NSNumber *)height {
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"NotInitialized"
                                       reason:@"PixelFree not initialized"
                                     userInfo:nil];
    }
    
    int texID = [textureID intValue];
    int w = [width intValue];
    int h = [height intValue];
    
    [self.mPixelFree processWithTexture:texID width:w height:h rotation:PFRotationMode0];
    
    return textureID;
}

/**
 * 设置检测模式
 * @param mode 0=IMAGE, 1=VIDEO
 */
- (void)setDetectMode:(NSNumber *)mode {
    if (!self.mPixelFree) {
        @throw [NSException exceptionWithName:@"NotInitialized"
                                       reason:@"PixelFree not initialized"
                                     userInfo:nil];
    }
    
    int modeInt = [mode intValue];
    [self.mPixelFree setDetectMode:modeInt];
}

/**
 * 检查是否检测到人脸
 */
- (BOOL)hasFace {
    if (!self.mPixelFree) {
        return NO;
    }
    return [self.mPixelFree hasFace];
}

/**
 * 获取人脸数量
 */
- (NSNumber *)getFaceSize {
    if (!self.mPixelFree) {
        return @(0);
    }
    // iOS SDK 可能没有直接的人脸数量接口，需要根据实际 SDK 调整
    return @(0);
}


/**
 * 创建 CVPixelBuffer 从 RGBA 数据
 */
- (CVPixelBufferRef)getRenderTargetWithWidth:(int)w height:(int)h rgbaBuffer:(char *)rgbaData {
    CFDictionaryRef empty;
    CFMutableDictionaryRef attrs;
    empty = CFDictionaryCreate(kCFAllocatorDefault,
                               NULL,
                               NULL,
                               0,
                               &kCFTypeDictionaryKeyCallBacks,
                               &kCFTypeDictionaryValueCallBacks);
    attrs = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    CFDictionarySetValue(attrs, kCVPixelBufferIOSurfacePropertiesKey, empty);

    CVPixelBufferRef renderTarget;
    CVReturn theError = CVPixelBufferCreate(kCFAllocatorDefault,
                                            w,
                                            h,
                                            kCVPixelFormatType_32BGRA,
                                            attrs,
                                            &renderTarget);

    if (theError) {
        CFRelease(attrs);
        CFRelease(empty);
        return NULL;
    }

    CVPixelBufferLockBaseAddress(renderTarget, 0);
    void *baseAddress = CVPixelBufferGetBaseAddress(renderTarget);
    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(renderTarget);

    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            int pixelStart = (y * w + x) * 4;
            unsigned char *pixel = baseAddress + y * bytesPerRow + x * 4;
            pixel[0] = rgbaData[pixelStart + 2];  // B
            pixel[1] = rgbaData[pixelStart + 1];  // G
            pixel[2] = rgbaData[pixelStart];      // R
            pixel[3] = rgbaData[pixelStart + 3];  // A
        }
    }
    CVPixelBufferUnlockBaseAddress(renderTarget, 0);

    CFRelease(attrs);
    CFRelease(empty);
    
    return renderTarget;
}

@end

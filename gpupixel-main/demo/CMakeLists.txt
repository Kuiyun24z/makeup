# ---- Application project definition ----
# Main desktop demo application for GPUPixel library
set(GPL_APP_NAME "app")

# ---- Source files configuration ----
# add desktop application source files
set(APP_SOURCE_FILES "${CMAKE_CURRENT_SOURCE_DIR}/desktop/app.cc")

# add ImGui source files ImGui provides the GUI components for the desktop demo
file(GLOB IMGUI_SOURCE_FILES "${PROJECT_SOURCE_DIR}/third_party/imgui/*.cpp"
     "${PROJECT_SOURCE_DIR}/third_party/imgui/backends/imgui_impl_glfw.cpp"
     "${PROJECT_SOURCE_DIR}/third_party/imgui/backends/imgui_impl_opengl3.cpp")
list(APPEND APP_SOURCE_FILES ${IMGUI_SOURCE_FILES})

# ---- Build configuration ----
# create executable from source files
add_executable(${GPL_APP_NAME} ${APP_SOURCE_FILES})

# set common include directories
target_include_directories(${GPL_APP_NAME}
                           PRIVATE ${PROJECT_SOURCE_DIR}/third_party/imgui)

# ---- Platform-specific configuration ----
# Each platform requires different compiler flags and linked libraries
if(APPLE)
  # macOS specific configuration Objective-C++ compilation and proper runtime
  # library paths
  set_target_properties(
    ${GPL_APP_NAME}
    PROPERTIES COMPILE_FLAGS "-x objective-c++"
               MACOSX_BUNDLE FALSE
               INSTALL_RPATH "@executable_path/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)

  target_compile_options(${GPL_APP_NAME} PRIVATE "-fno-objc-arc")
  target_link_libraries(
    ${GPL_APP_NAME}
    PRIVATE "-framework OpenGL"
            dl
            glad::glad
            glfw::glfw
            marsface::marsface
            gpupixel::gpupixel
            ghc::filesystem)
elseif(WIN32)
  # Windows specific configuration Support delayed loading of DLLs for better
  # startup performance
  target_compile_definitions(${GPL_APP_NAME} PRIVATE WINDOWS_DLL_DELAY_LOAD)

  target_link_libraries(
    ${GPL_APP_NAME} PRIVATE opengl32 delayimp glad::glad glfw::glfw
                            gpupixel::gpupixel ghc::filesystem)

  # set delayed DLL loading
  if(MSVC)
    set_target_properties(
      ${GPL_APP_NAME}
      PROPERTIES LINK_FLAGS
                 "/DELAYLOAD:gpupixel.dll /DELAYLOAD:mars-face-kit.dll")
  endif()

else()
  # Linux specific configuration Set runtime path to find shared libraries in
  # the lib subdirectory
  set_target_properties(
    ${GPL_APP_NAME} PROPERTIES INSTALL_RPATH "$ORIGIN/../lib"
                               BUILD_WITH_INSTALL_RPATH TRUE)

  target_link_libraries(
    ${GPL_APP_NAME}
    PRIVATE GL
            dl
            glad::glad
            glfw::glfw
            gpupixel::gpupixel
            ghc::filesystem
            stdc++fs)
endif()

# ---- Installation configuration ----
# Define where and how files should be installed
set(GPUPIXEL_PROCESSOR_NAME "gpupixel_processor")
add_executable(${GPUPIXEL_PROCESSOR_NAME}
               "${CMAKE_CURRENT_SOURCE_DIR}/desktop/processor.cc")
target_include_directories(
  ${GPUPIXEL_PROCESSOR_NAME}
  PRIVATE ${PROJECT_SOURCE_DIR}/third_party/glfw/deps)

if(APPLE)
  set_target_properties(
    ${GPUPIXEL_PROCESSOR_NAME}
    PROPERTIES COMPILE_FLAGS "-x objective-c++"
               MACOSX_BUNDLE FALSE
               INSTALL_RPATH "@executable_path/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_compile_options(${GPUPIXEL_PROCESSOR_NAME} PRIVATE "-fno-objc-arc")
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_NAME}
    PRIVATE "-framework OpenGL"
            dl
            glad::glad
            glfw::glfw
            marsface::marsface
            gpupixel::gpupixel
            ghc::filesystem)
elseif(WIN32)
  target_compile_definitions(${GPUPIXEL_PROCESSOR_NAME}
                             PRIVATE WINDOWS_DLL_DELAY_LOAD)
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_NAME}
    PRIVATE opengl32 delayimp glad::glad glfw::glfw gpupixel::gpupixel
            ghc::filesystem)
  if(MSVC)
    set_target_properties(
      ${GPUPIXEL_PROCESSOR_NAME}
      PROPERTIES LINK_FLAGS
                 "/DELAYLOAD:gpupixel.dll /DELAYLOAD:mars-face-kit.dll")
  endif()
else()
  set_target_properties(
    ${GPUPIXEL_PROCESSOR_NAME} PROPERTIES INSTALL_RPATH "$ORIGIN/../lib"
                                          BUILD_WITH_INSTALL_RPATH TRUE)
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_NAME}
    PRIVATE GL
            dl
            glad::glad
            glfw::glfw
            gpupixel::gpupixel
            ghc::filesystem
            stdc++fs)
endif()

set(GPUPIXEL_PROCESSOR_MP468_NAME "gpupixel_processor_mp468")
add_executable(${GPUPIXEL_PROCESSOR_MP468_NAME}
               "${CMAKE_CURRENT_SOURCE_DIR}/desktop/processor_mp468.cc")
target_include_directories(
  ${GPUPIXEL_PROCESSOR_MP468_NAME}
  PRIVATE ${PROJECT_SOURCE_DIR}/third_party/glfw/deps)

if(APPLE)
  set_target_properties(
    ${GPUPIXEL_PROCESSOR_MP468_NAME}
    PROPERTIES COMPILE_FLAGS "-x objective-c++"
               MACOSX_BUNDLE FALSE
               INSTALL_RPATH "@executable_path/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_compile_options(${GPUPIXEL_PROCESSOR_MP468_NAME} PRIVATE "-fno-objc-arc")
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_MP468_NAME}
    PRIVATE "-framework OpenGL"
            dl
            glad::glad
            glfw::glfw
            marsface::marsface
            gpupixel::gpupixel
            ghc::filesystem)
elseif(WIN32)
  target_compile_definitions(${GPUPIXEL_PROCESSOR_MP468_NAME}
                             PRIVATE WINDOWS_DLL_DELAY_LOAD)
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_MP468_NAME}
    PRIVATE opengl32 delayimp glad::glad glfw::glfw gpupixel::gpupixel
            ghc::filesystem)
  if(MSVC)
    set_target_properties(
      ${GPUPIXEL_PROCESSOR_MP468_NAME}
      PROPERTIES LINK_FLAGS
                 "/DELAYLOAD:gpupixel.dll /DELAYLOAD:mars-face-kit.dll")
  endif()
else()
  set_target_properties(
    ${GPUPIXEL_PROCESSOR_MP468_NAME}
    PROPERTIES INSTALL_RPATH "$ORIGIN/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_MP468_NAME}
    PRIVATE GL
            dl
            glad::glad
            glfw::glfw
            gpupixel::gpupixel
            ghc::filesystem
            stdc++fs)
endif()

set(GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME "gpupixel_processor_mp468_daemon")
add_executable(${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
               "${CMAKE_CURRENT_SOURCE_DIR}/desktop/processor_mp468_daemon.cc")
target_include_directories(
  ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
  PRIVATE ${PROJECT_SOURCE_DIR}/third_party/glfw/deps)

if(APPLE)
  set_target_properties(
    ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
    PROPERTIES COMPILE_FLAGS "-x objective-c++"
               MACOSX_BUNDLE FALSE
               INSTALL_RPATH "@executable_path/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_compile_options(${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
                         PRIVATE "-fno-objc-arc")
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
    PRIVATE "-framework OpenGL"
            dl
            glad::glad
            glfw::glfw
            marsface::marsface
            gpupixel::gpupixel
            ghc::filesystem)
elseif(WIN32)
  target_compile_definitions(${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
                             PRIVATE WINDOWS_DLL_DELAY_LOAD)
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
    PRIVATE opengl32 delayimp glad::glad glfw::glfw gpupixel::gpupixel
            ghc::filesystem)
  if(MSVC)
    set_target_properties(
      ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
      PROPERTIES LINK_FLAGS
                 "/DELAYLOAD:gpupixel.dll /DELAYLOAD:mars-face-kit.dll")
  endif()
else()
  set_target_properties(
    ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
    PROPERTIES INSTALL_RPATH "$ORIGIN/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_link_libraries(
    ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
    PRIVATE GL
            dl
            glad::glad
            glfw::glfw
            gpupixel::gpupixel
            ghc::filesystem
            stdc++fs)
endif()

set(GPUPIXEL_VIDEO_CLIENT_NAME "gpupixel_video_client")
add_executable(
  ${GPUPIXEL_VIDEO_CLIENT_NAME}
  "${CMAKE_CURRENT_SOURCE_DIR}/desktop/video_client_mp468.cc"
  "${CMAKE_CURRENT_SOURCE_DIR}/desktop/lip_renderer_mp468.cc"
  "${CMAKE_CURRENT_SOURCE_DIR}/desktop/eyebrow_renderer_mp468.cc"
  ${IMGUI_SOURCE_FILES})
set_target_properties(${GPUPIXEL_VIDEO_CLIENT_NAME}
                      PROPERTIES OUTPUT_NAME "gpupixel_video_client_v21")
target_include_directories(
  ${GPUPIXEL_VIDEO_CLIENT_NAME}
  PRIVATE ${PROJECT_SOURCE_DIR}/third_party/imgui
          ${PROJECT_SOURCE_DIR}/third_party/glfw/deps)

if(APPLE)
  set_target_properties(
    ${GPUPIXEL_VIDEO_CLIENT_NAME}
    PROPERTIES COMPILE_FLAGS "-x objective-c++"
               MACOSX_BUNDLE FALSE
               INSTALL_RPATH "@executable_path/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_compile_options(${GPUPIXEL_VIDEO_CLIENT_NAME}
                         PRIVATE "-fno-objc-arc")
  target_link_libraries(
    ${GPUPIXEL_VIDEO_CLIENT_NAME}
    PRIVATE "-framework OpenGL"
            dl
            glad::glad
            glfw::glfw
            marsface::marsface
            gpupixel::gpupixel
            ghc::filesystem)
elseif(WIN32)
  target_compile_definitions(${GPUPIXEL_VIDEO_CLIENT_NAME}
                             PRIVATE WINDOWS_DLL_DELAY_LOAD)
  target_link_libraries(
    ${GPUPIXEL_VIDEO_CLIENT_NAME}
    PRIVATE opengl32
            delayimp
            mf
            mfplat
            mfreadwrite
            mfuuid
            ole32
            Shlwapi
            glad::glad
            glfw::glfw
            gpupixel::gpupixel
            ghc::filesystem)
  if(MSVC)
    set_target_properties(
      ${GPUPIXEL_VIDEO_CLIENT_NAME}
      PROPERTIES LINK_FLAGS
                 "/DELAYLOAD:gpupixel.dll /DELAYLOAD:mars-face-kit.dll")
  endif()
else()
  set_target_properties(
    ${GPUPIXEL_VIDEO_CLIENT_NAME}
    PROPERTIES INSTALL_RPATH "$ORIGIN/../lib"
               BUILD_WITH_INSTALL_RPATH TRUE)
  target_link_libraries(
    ${GPUPIXEL_VIDEO_CLIENT_NAME}
    PRIVATE GL
            dl
            glad::glad
            glfw::glfw
            gpupixel::gpupixel
            ghc::filesystem
            stdc++fs)
endif()

if(GPUPIXEL_INSTALL)
  install(
    TARGETS ${GPL_APP_NAME}
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin)

  install(
    TARGETS ${GPUPIXEL_PROCESSOR_NAME}
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin)

  install(
    TARGETS ${GPUPIXEL_PROCESSOR_MP468_NAME}
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin)

  install(
    TARGETS ${GPUPIXEL_PROCESSOR_MP468_DAEMON_NAME}
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin)

  install(
    TARGETS ${GPUPIXEL_VIDEO_CLIENT_NAME}
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
    RUNTIME DESTINATION bin)

  # Install resource files
  install(
    FILES ${CMAKE_CURRENT_SOURCE_DIR}/desktop/demo.png
    DESTINATION bin
    COMPONENT resource)

  file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/desktop/demo.png
       DESTINATION ${BUILD_OUTPUT_DIR}/bin)
endif()

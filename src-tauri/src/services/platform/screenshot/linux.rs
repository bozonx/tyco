use super::{pixel_bytes, Pixels, Screen};
use crate::{errors::AppError, models::ScreenshotCaptureMode, services::platform::session};

pub(crate) fn selects_area_natively() -> bool {
    session::current().is_wayland()
}
use x11rb::{
    connection::Connection,
    protocol::{
        randr::ConnectionExt as _,
        xproto::{ConnectionExt as _, ImageFormat, ImageOrder},
    },
};

fn failed(error: impl std::fmt::Display) -> AppError {
    AppError::Failed(format!("Screenshot capture failed: {error}"))
}

pub(super) fn screen() -> Result<Option<Screen>, AppError> {
    if !session::current().is_x11() {
        return Ok(None);
    }
    let (connection, index) = x11rb::connect(None).map_err(failed)?;
    let root = &connection.setup().roots[index];
    let pointer = connection
        .query_pointer(root.root)
        .map_err(failed)?
        .reply()
        .map_err(failed)?;
    let monitors = connection
        .randr_get_monitors(root.root, true)
        .map_err(failed)?
        .reply()
        .map_err(failed)?;
    let monitor = monitors
        .monitors
        .iter()
        .find(|m| {
            i32::from(pointer.root_x) >= i32::from(m.x)
                && i32::from(pointer.root_x) < i32::from(m.x) + i32::from(m.width)
                && i32::from(pointer.root_y) >= i32::from(m.y)
                && i32::from(pointer.root_y) < i32::from(m.y) + i32::from(m.height)
        })
        .ok_or_else(|| AppError::ServiceUnavailable("No screen at the pointer".into()))?;
    pixel_bytes(u32::from(monitor.width), u32::from(monitor.height))?;
    Ok(Some(Screen {
        x: monitor.x.into(),
        y: monitor.y.into(),
        width: monitor.width.into(),
        height: monitor.height.into(),
    }))
}

pub(super) fn capture(
    screen: Option<Screen>,
    mode: ScreenshotCaptureMode,
) -> Result<Option<Pixels>, AppError> {
    if session::current().is_x11() {
        return capture_x11(screen.ok_or_else(|| AppError::invalid_input("Missing monitor"))?)
            .map(Some);
    }
    if !session::current().is_wayland() {
        return Err(AppError::ServiceUnavailable(
            "Screenshot capture needs a graphical session".into(),
        ));
    }
    tauri::async_runtime::block_on(capture_portal(mode))
}

fn capture_x11(screen: Screen) -> Result<Pixels, AppError> {
    let size = pixel_bytes(screen.width, screen.height)?;
    let (connection, index) = x11rb::connect(None).map_err(failed)?;
    let setup = connection.setup();
    let root = &setup.roots[index];
    let format = setup
        .pixmap_formats
        .iter()
        .find(|f| f.depth == root.root_depth)
        .ok_or_else(|| AppError::invalid_data("Unsupported screen pixel format"))?;
    let visual = root
        .allowed_depths
        .iter()
        .flat_map(|d| &d.visuals)
        .find(|v| v.visual_id == root.root_visual)
        .ok_or_else(|| AppError::invalid_data("Missing screen visual"))?;
    let reply = connection
        .get_image(
            ImageFormat::Z_PIXMAP,
            root.root,
            screen.x as i16,
            screen.y as i16,
            screen.width as u16,
            screen.height as u16,
            u32::MAX,
        )
        .map_err(failed)?
        .reply()
        .map_err(failed)?;
    let bytes_per_pixel = usize::from(format.bits_per_pixel) / 8;
    if !(2..=4).contains(&bytes_per_pixel) || format.scanline_pad == 0 {
        return Err(AppError::invalid_data("Unsupported screen pixel format"));
    }
    let pad = usize::from(format.scanline_pad);
    let stride =
        (screen.width as usize * usize::from(format.bits_per_pixel)).div_ceil(pad) * pad / 8;
    if reply.data.len() != stride * screen.height as usize {
        return Err(AppError::invalid_data("Invalid screen pixel buffer"));
    }
    let mut bytes = vec![255; size];
    for y in 0..screen.height as usize {
        for x in 0..screen.width as usize {
            let offset = y * stride + x * bytes_per_pixel;
            let mut value = 0u32;
            for n in 0..bytes_per_pixel {
                let shift = if setup.image_byte_order == ImageOrder::LSB_FIRST {
                    n
                } else {
                    bytes_per_pixel - 1 - n
                };
                value |= u32::from(reply.data[offset + n]) << (shift * 8);
            }
            for (c, mask) in [visual.red_mask, visual.green_mask, visual.blue_mask]
                .into_iter()
                .enumerate()
            {
                if mask == 0 {
                    return Err(AppError::invalid_data("Unsupported screen color mask"));
                }
                bytes[(y * screen.width as usize + x) * 4 + c] =
                    (((value & mask) >> mask.trailing_zeros()) as u64 * 255
                        / u64::from(mask >> mask.trailing_zeros())) as u8;
            }
        }
    }
    Ok(Pixels {
        bytes,
        width: screen.width,
        height: screen.height,
    })
}

async fn capture_portal(mode: ScreenshotCaptureMode) -> Result<Option<Pixels>, AppError> {
    use ashpd::desktop::screenshot::{AvailableTargets, ScreenshotOptions, ScreenshotProxy};
    let proxy = ScreenshotProxy::new().await.map_err(failed)?;
    let mut options = ScreenshotOptions::default()
        .set_interactive(false)
        .set_modal(false);
    if proxy.version() >= 3 {
        let targets = proxy.available_targets().await.map_err(failed)?;
        match mode {
            ScreenshotCaptureMode::Area => {
                if targets.contains(AvailableTargets::Area) {
                    options = options.set_target(AvailableTargets::Area);
                } else {
                    options = options.set_interactive(true);
                }
            }
            ScreenshotCaptureMode::Screen => {
                if !targets.contains(AvailableTargets::Screen) {
                    return Err(AppError::ServiceUnavailable(
                        "The screenshot portal cannot capture an entire screen".into(),
                    ));
                }
                options = options.set_target(AvailableTargets::Screen);
            }
        }
    } else if mode == ScreenshotCaptureMode::Area {
        options = options.set_interactive(true);
    }
    let request = proxy.screenshot(None, options).await.map_err(failed)?;
    let response = match request.response() {
        Ok(response) => response,
        Err(ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled)) => return Ok(None),
        Err(error) => return Err(failed(error)),
    };
    let url = url::Url::parse(response.uri().as_str()).map_err(failed)?;
    let path = url
        .to_file_path()
        .map_err(|_| AppError::invalid_data("Screenshot portal returned a non-file URI"))?;
    read_portal_image(&path).map(Some)
}

fn read_portal_image(path: &std::path::Path) -> Result<Pixels, AppError> {
    use std::io::Read;
    // Portal owns the returned file. Do not delete arbitrary portal paths.
    let file = std::fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::invalid_data("Invalid screenshot file"));
    }
    let mut data = Vec::new();
    file.take(128 * 1024 * 1024 + 1).read_to_end(&mut data)?;
    if data.len() > 128 * 1024 * 1024 {
        return Err(AppError::FileTooLarge(
            "Screenshot size limit exceeded".into(),
        ));
    }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(data));
    decoder.set_limits(png::Limits {
        bytes: 256 * 1024 * 1024,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(failed)?;
    let width = reader.info().width;
    let height = reader.info().height;
    let size = pixel_bytes(width, height)?;
    if reader.info().animation_control.is_some() {
        return Err(AppError::invalid_data("Animated screenshot"));
    }
    let mut decoded =
        vec![
            0;
            reader
                .output_buffer_size()
                .ok_or_else(|| AppError::invalid_data("Invalid screenshot dimensions"))?
        ];
    let output = reader.next_frame(&mut decoded).map_err(failed)?;
    let mut bytes = vec![255; size];
    let channels = output.color_type.samples();
    for (source, target) in decoded[..output.buffer_size()]
        .chunks_exact(channels)
        .zip(bytes.as_chunks_mut::<4>().0)
    {
        match output.color_type {
            png::ColorType::Rgb => target[..3].copy_from_slice(source),
            png::ColorType::Rgba => target.copy_from_slice(source),
            png::ColorType::Grayscale => target[..3].fill(source[0]),
            png::ColorType::GrayscaleAlpha => {
                target[..3].fill(source[0]);
                target[3] = source[1];
            }
            _ => return Err(AppError::invalid_data("Unsupported screenshot format")),
        }
    }
    Ok(Pixels {
        bytes,
        width,
        height,
    })
}

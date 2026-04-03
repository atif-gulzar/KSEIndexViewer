use crate::scraper_service::IndexData;
use ab_glyph::{FontRef, PxScale};
use image::{Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use tauri::image::Image as TauriImage;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::{AppHandle, Emitter, Manager};

const FONT_DATA: &[u8] = include_bytes!("../fonts/Arial_Bold.ttf");
const DEFAULT_ICON: &[u8] = include_bytes!("../icons/icon.png");

// Material Design green bands (50 → 900)
const GREEN_BANDS: [[u8; 3]; 10] = [
    [232, 245, 233], // 0-1%
    [200, 230, 201], // 1-2%
    [165, 214, 167], // 2-3%
    [129, 199, 132], // 3-4%
    [102, 187, 106], // 4-5%
    [76,  175,  80], // 5-6%
    [67,  160,  71], // 6-7%
    [56,  142,  60], // 7-8%
    [46,  125,  50], // 8-9%
    [27,   94,  32], // 9%+
];

// Material Design red bands (50 → 900)
const RED_BANDS: [[u8; 3]; 10] = [
    [255, 235, 238], // 0-1%
    [255, 205, 210], // 1-2%
    [239, 154, 154], // 2-3%
    [229, 115, 115], // 3-4%
    [239,  83,  80], // 4-5%
    [244,  67,  54], // 5-6%
    [229,  57,  53], // 6-7%
    [211,  47,  47], // 7-8%
    [198,  40,  40], // 8-9%
    [183,  28,  28], // 9%+
];

fn create_icon_image(percent_change: f64) -> Vec<u8> {
    let size = 128u32;
    let is_positive = percent_change >= 0.0;
    let band = (percent_change.abs().floor() as usize).min(9);

    let rgb = if is_positive { GREEN_BANDS[band] } else { RED_BANDS[band] };
    let bg = Rgba([rgb[0], rgb[1], rgb[2], 255]);

    // Black text on bands 0-6, white on bands 7-9
    let text_color = if band >= 7 {
        Rgba([255u8, 255, 255, 255])
    } else {
        Rgba([0u8, 0, 0, 255])
    };

    let mut img = RgbaImage::from_pixel(size, size, bg);
    let text = format!("{:.1}", percent_change.abs());

    if let Ok(font) = FontRef::try_from_slice(FONT_DATA) {
        let scale = if text.len() > 4 {
            PxScale::from(52.0)
        } else {
            PxScale::from(64.0)
        };

        // Rough centering
        let text_width_est = text.len() as i32 * (scale.x * 0.55) as i32;
        let x = ((size as i32 - text_width_est) / 2).max(2);
        let y = ((size as f32 - scale.y) / 2.0) as i32;

        // Draw twice with 1px offset for extra boldness
        draw_text_mut(&mut img, text_color, x, y, scale, &font, &text);
        draw_text_mut(&mut img, text_color, x + 1, y, scale, &font, &text);
    }

    img.into_raw()
}

pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show Widget").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "Refresh Now").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Exit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&refresh)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;

    let default_img = image::load_from_memory(DEFAULT_ICON)
        .expect("failed to load default icon")
        .to_rgba8();
    let (w, h) = default_img.dimensions();
    let icon = TauriImage::new_owned(default_img.into_raw(), w, h);

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("KSE Index Viewer")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "refresh" => {
                    let _ = app.emit("trigger-refresh", ());
                }
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit("show-settings", ());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn update_tray_icon(app: &AppHandle, data: &[IndexData], pinned_name: &str) {
    let pinned = data.iter().find(|d| d.name == pinned_name);

    if let Some(tray) = app.tray_by_id("main") {
        if let Some(index) = pinned {
            let icon_data = create_icon_image(index.percent_change);
            let icon = TauriImage::new_owned(icon_data, 128, 128);
            let _ = tray.set_icon(Some(icon));

            let sign = if index.percent_change >= 0.0 { "+" } else { "" };
            let tooltip = format!(
                "{}: {}{}% | Current: {:.2}",
                index.name,
                sign,
                format!("{:.1}", index.percent_change),
                index.current
            );
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    }
}

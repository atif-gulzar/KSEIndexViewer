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

fn create_icon_image(text: &str, is_positive: bool) -> Vec<u8> {
    let size = 128u32;
    let bg = if is_positive {
        Rgba([134u8, 239, 172, 255]) // light green
    } else {
        Rgba([252u8, 165, 165, 255]) // light red
    };
    let text_color = Rgba([0u8, 0, 0, 255]); // black

    let mut img = RgbaImage::from_pixel(size, size, bg);

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
        draw_text_mut(&mut img, text_color, x, y, scale, &font, text);
        draw_text_mut(&mut img, text_color, x + 1, y, scale, &font, text);
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
            let text = format!("{:.1}", index.percent_change.abs());
            let is_positive = index.percent_change >= 0.0;
            let icon_data = create_icon_image(&text, is_positive);
            let icon = TauriImage::new_owned(icon_data, 128, 128);
            let _ = tray.set_icon(Some(icon));

            let sign = if is_positive { "+" } else { "-" };
            let tooltip = format!(
                "{}: {}{}% | Current: {:.2}",
                index.name,
                sign,
                text,
                index.current
            );
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    }
}

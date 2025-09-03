#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    AppHandle, CustomMenuItem, GlobalShortcutManager, Manager, SystemTray, SystemTrayEvent,
    SystemTrayMenu, WindowBuilder, WindowUrl, State
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use auto_launch::AutoLaunchBuilder;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AIEngine {
    name: String,
    url: String,
    logo: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AppConfig {
    shortcut: String,
    #[serde(rename = "aiEngines")]
    ai_engines: Vec<AIEngine>,
    #[serde(rename = "defaultAi", default = "default_ai_index")]
    default_ai: usize,
    theme: String,
    #[serde(rename = "autoStart", default = "default_auto_start")]
    auto_start: bool,
}

fn default_auto_start() -> bool {
    false
}

fn default_ai_index() -> usize {
    0
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut: "Alt+Space".to_string(),
            ai_engines: vec![],
            default_ai: 0,
            theme: "dark".to_string(),
            auto_start: false,
        }
    }
}

type ConfigState = Mutex<AppConfig>;

fn get_config_path(app_handle: &AppHandle) -> PathBuf {
    let mut path = app_handle
        .path_resolver()
        .app_data_dir()
        .expect("Failed to get app data dir");

    if !path.exists() {
        if let Err(e) = fs::create_dir_all(&path) {
            eprintln!("Failed to create app data directory {}: {}", path.display(), e);
        }
    }

    path.push("config.json");
    path
}

fn load_config(app_handle: &AppHandle, config_state: &ConfigState) {
    let config_path = get_config_path(app_handle);
    let mut config_guard = config_state.lock().unwrap();

    match fs::read_to_string(&config_path) {
        Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
            Ok(mut loaded_config) => {
                if loaded_config.default_ai >= loaded_config.ai_engines.len() && !loaded_config.ai_engines.is_empty() {
                    loaded_config.default_ai = 0;
                } else if loaded_config.ai_engines.is_empty() {
                    loaded_config.default_ai = 0;
                }
                
                *config_guard = loaded_config;
                eprintln!("Config loaded: {:?}", *config_guard);
            }
            Err(e) => {
                eprintln!("Error parsing config: {}", e);
                *config_guard = AppConfig::default();
                save_config_to_file(app_handle, &*config_guard);
            }
        },
        Err(_) => {
            eprintln!("Config file not found, creating default");
            *config_guard = AppConfig::default();
            save_config_to_file(app_handle, &*config_guard);
        }
    }
}

fn save_config_to_file(app_handle: &AppHandle, config: &AppConfig) {
    let config_path = get_config_path(app_handle);
    
    match serde_json::to_string_pretty(config) {
        Ok(json_string) => {
            if let Err(e) = fs::write(&config_path, json_string) {
                eprintln!("Error writing config: {}", e);
            } else {
                eprintln!("Config saved to: {}", config_path.display());
            }
        }
        Err(e) => eprintln!("Error serializing config: {}", e),
    }
}

fn manage_autostart(enable: bool) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe: {}", e))?;
    
    let auto = AutoLaunchBuilder::new()
        .set_app_name("AIBar")
        .set_app_path(current_exe.to_str().ok_or("Invalid executable path")?)
        .set_use_launch_agent(true)
        .build()
        .map_err(|e| format!("Failed to create AutoLaunch: {}", e))?;

    if enable {
        if !auto.is_enabled().unwrap_or(false) {
            auto.enable().map_err(|e| format!("Failed to enable autostart: {}", e))?;
            eprintln!("Autostart enabled");
        }
    } else {
        if auto.is_enabled().unwrap_or(false) {
            auto.disable().map_err(|e| format!("Failed to disable autostart: {}", e))?;
            eprintln!("Autostart disabled");
        }
    }

    Ok(())
}

fn open_settings_window(app_handle: &AppHandle) {
    if let Some(settings_window) = app_handle.get_window("settings") {
        let _ = settings_window.show();
        let _ = settings_window.set_focus();
        let _ = settings_window.center();
    } else {
        let settings_window = WindowBuilder::new(
            app_handle,
            "settings",
            WindowUrl::App("index.html".into()),
        )
        .title("AIBar Settings")
        .inner_size(480.0, 720.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build();

        if let Ok(window) = settings_window {
            let _ = window.show();
        }
    }
}

fn register_shortcut(app_handle: &AppHandle, shortcut: &str) -> Result<(), String> {
    let app_handle_clone = app_handle.clone();
    let mut shortcut_manager = app_handle.global_shortcut_manager();
    
    shortcut_manager
        .register(shortcut, move || {
            let config_state = app_handle_clone.state::<ConfigState>();
            let config = config_state.lock().unwrap();

            if config.ai_engines.is_empty() {
                open_settings_window(&app_handle_clone);
            } else {
                if let Some(window) = app_handle_clone.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    
                    if let Ok(monitor) = window.current_monitor() {
                        if let Some(monitor) = monitor {
                            let screen_size = monitor.size();
                            let window_size = window.inner_size().unwrap_or_default();
                            
                            let x = (screen_size.width as i32 - window_size.width as i32) / 2;
                            let y = screen_size.height as i32 / 4;
                            
                            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                        }
                    } else {
                        let _ = window.center();
                    }
                    
                    let _ = window.eval("
                        const input = document.getElementById('search-input');
                        if (input) {
                            input.value = '';
                            input.focus();
                        }
                    ");
                }
            }
        })
        .map_err(|e| format!("Failed to register shortcut: {}", e))
}


#[tauri::command]
fn get_config(config_state: State<ConfigState>) -> AppConfig {
    config_state.lock().unwrap().clone()
}

#[tauri::command]
fn save_config_command(
    app_handle: AppHandle,
    config_state: State<ConfigState>,
    shortcut: String,
    theme: String,
    auto_start: bool,
    ai_engines: Vec<AIEngine>,
    default_ai: Option<usize>,
) -> Result<(), String> {
    let old_shortcut = {
        let config = config_state.lock().unwrap();
        config.shortcut.clone()
    };

    let validated_default_ai = if ai_engines.is_empty() {
        0
    } else {
        default_ai.unwrap_or(0).min(ai_engines.len().saturating_sub(1))
    };

    eprintln!("Saving config with default_ai: {} (total engines: {})", validated_default_ai, ai_engines.len());

    {
        let mut config = config_state.lock().unwrap();
        config.shortcut = shortcut.clone();
        config.theme = theme.clone();
        config.auto_start = auto_start;
        config.ai_engines = ai_engines;
        config.default_ai = validated_default_ai;
        
        eprintln!("New config state: {:?}", *config);
        save_config_to_file(&app_handle, &*config);
    }

    if let Err(e) = manage_autostart(auto_start) {
        eprintln!("Failed to manage autostart: {}", e);
    }

    if old_shortcut != shortcut {
        let mut shortcut_manager = app_handle.global_shortcut_manager();
        let _ = shortcut_manager.unregister(&old_shortcut);
        register_shortcut(&app_handle, &shortcut)?;
    }

    let updated_config = {
        let config = config_state.lock().unwrap();
        config.clone()
    };

    let config_json = serde_json::to_string(&updated_config).unwrap_or_default();
    
    if let Some(main_window) = app_handle.get_window("main") {
        let _ = main_window.eval(&format!(
            "window.updateConfig && window.updateConfig({})",
            config_json
        ));
    }

    if let Some(settings_window) = app_handle.get_window("settings") {
        let _ = settings_window.eval(&format!(
            "window.updateConfig && window.updateConfig({})",
            config_json
        ));
    }

    Ok(())
}

fn create_tray() -> SystemTray {
    let settings = CustomMenuItem::new("settings".to_string(), "Settings");
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let tray_menu = SystemTrayMenu::new().add_item(settings).add_item(quit);

    SystemTray::new().with_menu(tray_menu)
}

fn main() {
    let config_state = ConfigState::new(AppConfig::default());

    tauri::Builder::default()
        .manage(config_state)
        .setup(|app| {
            let app_handle = app.handle();
            let config_state = app.state::<ConfigState>();

            load_config(&app_handle, &config_state);

            if let Some(main_window) = app.get_window("main") {
                let config = config_state.lock().unwrap();
                let config_json = serde_json::to_string(&*config).unwrap_or_default();
                let _ = main_window.eval(&format!(
                    "window.updateConfig && window.updateConfig({})",
                    config_json
                ));
                eprintln!("Sent config to main window on startup: default_ai = {}", config.default_ai);
            }

            let auto_start_enabled = {
                let config = config_state.lock().unwrap();
                config.auto_start
            };
            
            if let Err(e) = manage_autostart(auto_start_enabled) {
                eprintln!("Failed to setup autostart: {}", e);
            }

            let shortcut = {
                let config = config_state.lock().unwrap();
                config.shortcut.clone()
            };

            if let Err(e) = register_shortcut(&app_handle, &shortcut) {
                eprintln!("Error registering shortcut: {}", e);
            }

            if let Some(window) = app_handle.get_window("main") {
                let _ = window.hide();
            }

            Ok(())
        })
        .system_tray(create_tray())
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "settings" => {
                    open_settings_window(app);
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| {
            match event.event() {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    event.window().hide().unwrap();
                    api.prevent_close();
                }
                tauri::WindowEvent::Focused(focused) => {
                    if !focused && event.window().label() == "main" {
                        let _ = event.window().hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![get_config, save_config_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
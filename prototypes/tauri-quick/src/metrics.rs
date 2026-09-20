use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos()
}

#[derive(Default, Clone, serde::Serialize)]
pub struct Trial {
    pub id: u64,
    /// Момент нажатия хоткея. Приходит от bench, не от приложения.
    pub t0_trigger: u128,
    /// Запрос дошёл до IPC-потока приложения.
    pub t1_ipc: Option<u128>,
    /// Вызван show() на главном потоке.
    pub t2_show: Option<u128>,
    /// Первый кадр после show, по requestAnimationFrame в вебвью.
    pub t3_frame: Option<u128>,
    /// WindowEvent::Focused(true) от ОС.
    pub t4_os_focus: Option<u128>,
    /// JS поставил фокус в поле и подтвердил это.
    pub t4_dom_focus: Option<u128>,
    /// Первый символ, реально долетевший до поля.
    pub t5_first_char: Option<u128>,
    /// Что в поле оказалось к моменту опроса.
    pub value: String,
}

pub struct Metrics {
    trials: Mutex<HashMap<u64, Trial>>,
    csv: Mutex<Option<BufWriter<File>>>,
    strategy: String,
}

impl Metrics {
    pub fn new(path: Option<String>, strategy: String) -> Self {
        let csv = path.map(|path| {
            let file = File::create(&path).expect("не удалось создать CSV");
            let mut writer = BufWriter::new(file);
            writeln!(
                writer,
                "trial,strategy,chars_sent,chars_landed,lost,extra,ms_show,ms_frame,ms_os_focus,ms_dom_focus,ms_first_char"
            )
            .ok();
            writer.flush().ok();
            writer
        });

        Self { trials: Mutex::new(HashMap::new()), csv: Mutex::new(csv), strategy }
    }

    pub fn start(&self, id: u64, t0: u128) {
        let mut trials = self.trials.lock().unwrap();
        trials.insert(id, Trial { id, t0_trigger: t0, t1_ipc: Some(now_ns()), ..Trial::default() });
    }

    pub fn mark<F: FnOnce(&mut Trial)>(&self, id: u64, apply: F) {
        let mut trials = self.trials.lock().unwrap();
        if let Some(trial) = trials.get_mut(&id) {
            apply(trial);
        }
    }

    /// Пометить последнюю начатую попытку: событие фокуса от ОС не несёт trial id.
    pub fn mark_latest<F: FnOnce(&mut Trial)>(&self, apply: F) {
        let mut trials = self.trials.lock().unwrap();
        if let Some(trial) = trials.values_mut().max_by_key(|trial| trial.t0_trigger) {
            apply(trial);
        }
    }

    pub fn get(&self, id: u64) -> Option<Trial> {
        self.trials.lock().unwrap().get(&id).cloned()
    }

    /// Пропуски не заменяются нулями: отсутствующая метка остаётся пустой ячейкой.
    pub fn write_row(&self, id: u64, chars_sent: usize) {
        let Some(trial) = self.get(id) else { return };
        let mut csv = self.csv.lock().unwrap();
        let Some(writer) = csv.as_mut() else { return };

        let ms = |value: Option<u128>| match value {
            Some(value) if value >= trial.t0_trigger => {
                format!("{:.1}", (value - trial.t0_trigger) as f64 / 1_000_000.0)
            }
            _ => String::new(),
        };

        let landed = trial.value.chars().count();
        writeln!(
            writer,
            "{},{},{},{},{},{},{},{},{},{},{}",
            trial.id,
            self.strategy,
            chars_sent,
            landed,
            chars_sent.saturating_sub(landed),
            landed.saturating_sub(chars_sent),
            ms(trial.t2_show),
            ms(trial.t3_frame),
            ms(trial.t4_os_focus),
            ms(trial.t4_dom_focus),
            ms(trial.t5_first_char),
        )
        .ok();
        writer.flush().ok();
    }
}

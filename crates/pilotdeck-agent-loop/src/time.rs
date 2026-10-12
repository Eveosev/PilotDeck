//! Minimal UTC ISO-8601 helpers. Avoids a chrono dependency for S0–S2.

pub fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_iso() -> String {
    format_unix_ms(now_unix_ms())
}

pub fn format_unix_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000) as u32;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_epoch_days(days);
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

pub fn parse_iso_ms(value: &str) -> Option<i64> {
    let body = value.trim().strip_suffix('Z')?;
    let (date, time) = body.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i32 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() {
        return None;
    }
    let (hms, frac) = match time.split_once('.') {
        Some((hms, frac)) => (hms, Some(frac)),
        None => (time, None),
    };
    let mut time_parts = hms.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.parse().ok()?;
    if time_parts.next().is_some() {
        return None;
    }
    if hour > 23 || minute > 59 || second > 60 || !(1..=12).contains(&month) || day == 0 {
        return None;
    }
    let millis = match frac {
        Some(raw) if !raw.is_empty() => {
            let digits: String = raw.chars().take(3).collect();
            format!("{digits:0<3}").parse::<u32>().ok()?
        }
        _ => 0,
    };
    let days = epoch_days(year, month, day)?;
    Some(
        days * 86_400_000
            + i64::from(hour) * 3_600_000
            + i64::from(minute) * 60_000
            + i64::from(second) * 1000
            + i64::from(millis),
    )
}

fn civil_from_epoch_days(days: i64) -> (i32, u32, u32) {
    // Howard Hinnant: days since 1970-01-01 → civil year/month/day.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month as u32, day as u32)
}

fn epoch_days(year: i32, month: u32, day: u32) -> Option<i64> {
    if day == 0 || month == 0 || month > 12 {
        return None;
    }
    let y = if month <= 2 {
        i64::from(year) - 1
    } else {
        i64::from(year)
    };
    let m = i64::from(if month <= 2 { month + 9 } else { month - 3 });
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let doy = (153 * m as u64 + 2) / 5 + u64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe as i64 - 719_468)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_unix_epoch() {
        assert_eq!(format_unix_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_iso_ms("2026-09-01T00:00:00.000Z"),
            Some(1_788_220_800_000)
        );
    }
}

//! Tiny SPICE-like netlist for circuit modules (ADR-0007).
//!
//! ```text
//! * comment
//! V vin in 0 IN 10        input source; +-1.0 audio maps to +-10 V
//! R r1 in out 2.2k
//! C c1 out 0 10n
//! D d1 out 0 1N4148
//! OUT out 1.4             output node and makeup gain
//! ```

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Node {
    Ground,
    N(usize),
}

#[derive(Clone, Copy, Debug)]
pub struct DiodeModel {
    pub is: f64,
    pub n: f64,
}

#[derive(Clone, Debug)]
pub enum Elem {
    R { a: Node, b: Node, ohms: f64 },
    C { a: Node, b: Node, farads: f64 },
    D { a: Node, k: Node, model: DiodeModel },
    VIn { p: Node, n: Node, scale: f64 },
}

#[derive(Debug)]
pub struct Netlist {
    pub node_count: usize,
    pub elems: Vec<Elem>,
    pub out: Node,
    pub out_gain: f64,
}

pub fn parse_value(s: &str) -> Result<f64, String> {
    let t = s.trim().to_ascii_lowercase();
    let split = t
        .find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e')))
        .unwrap_or(t.len());
    // an 'e' that starts a suffix-less exponent is handled by f64 parsing
    let (num, suf) = t.split_at(split);
    let base: f64 = num.parse().map_err(|_| format!("bad number '{s}'"))?;
    let mult = match suf {
        "" => 1.0,
        "p" => 1e-12,
        "n" => 1e-9,
        "u" => 1e-6,
        "m" => 1e-3,
        "k" => 1e3,
        "meg" => 1e6,
        "g" => 1e9,
        _ => return Err(format!("bad suffix in '{s}'")),
    };
    Ok(base * mult)
}

fn diode_model(name: &str) -> Result<DiodeModel, String> {
    match name.to_ascii_uppercase().as_str() {
        "1N4148" => Ok(DiodeModel {
            is: 2.52e-9,
            n: 1.752,
        }),
        "1N34A" => Ok(DiodeModel { is: 2.0e-7, n: 1.3 }),
        "LED" => Ok(DiodeModel {
            is: 1.0e-18,
            n: 2.0,
        }),
        other => Err(format!("unknown diode model '{other}'")),
    }
}

pub fn parse(text: &str) -> Result<Netlist, String> {
    let mut names: Vec<String> = Vec::new();
    let mut node = |s: &str| -> Node {
        if s == "0" || s.eq_ignore_ascii_case("gnd") {
            return Node::Ground;
        }
        match names.iter().position(|n| n == s) {
            Some(i) => Node::N(i),
            None => {
                names.push(s.to_string());
                Node::N(names.len() - 1)
            }
        }
    };
    let mut elems = Vec::new();
    let mut out = None;
    let mut out_gain = 1.0;
    let mut have_in = false;
    for (ln, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('*') {
            continue;
        }
        let f: Vec<&str> = line.split_whitespace().collect();
        let err = |m: &str| format!("line {}: {m}", ln + 1);
        let kind = f[0].to_ascii_uppercase();
        match kind.chars().next().unwrap() {
            'R' if f.len() == 5 => {
                let ohms = parse_value(f[4]).map_err(|e| err(&e))?;
                if ohms <= 0.0 {
                    return Err(err("resistance must be positive"));
                }
                elems.push(Elem::R {
                    a: node(f[2]),
                    b: node(f[3]),
                    ohms,
                });
            }
            'C' if f.len() == 5 => {
                let farads = parse_value(f[4]).map_err(|e| err(&e))?;
                if farads <= 0.0 {
                    return Err(err("capacitance must be positive"));
                }
                elems.push(Elem::C {
                    a: node(f[2]),
                    b: node(f[3]),
                    farads,
                });
            }
            'D' if f.len() == 5 => {
                let model = diode_model(f[4]).map_err(|e| err(&e))?;
                elems.push(Elem::D {
                    a: node(f[2]),
                    k: node(f[3]),
                    model,
                });
            }
            'V' if f.len() >= 5 && f[4].eq_ignore_ascii_case("IN") => {
                if have_in {
                    return Err(err("only one input source is supported"));
                }
                have_in = true;
                let scale = f
                    .get(5)
                    .map(|s| parse_value(s))
                    .transpose()
                    .map_err(|e| err(&e))?;
                elems.push(Elem::VIn {
                    p: node(f[2]),
                    n: node(f[3]),
                    scale: scale.unwrap_or(1.0),
                });
            }
            'O' if kind == "OUT" && f.len() >= 2 => {
                out = Some(node(f[1]));
                if let Some(g) = f.get(2) {
                    out_gain = parse_value(g).map_err(|e| err(&e))?;
                }
            }
            _ => return Err(err(&format!("cannot parse '{line}'"))),
        }
    }
    if !have_in {
        return Err("netlist needs a 'V name n+ n- IN' input source".into());
    }
    let out = out.ok_or("netlist needs an 'OUT node' line")?;
    Ok(Netlist {
        node_count: names.len(),
        elems,
        out,
        out_gain,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_with_suffixes() {
        assert_eq!(parse_value("2.2k").unwrap(), 2200.0);
        assert!((parse_value("10n").unwrap() - 1e-8).abs() < 1e-20);
        assert_eq!(parse_value("1meg").unwrap(), 1e6);
        assert_eq!(parse_value("5").unwrap(), 5.0);
        assert!(parse_value("3x").is_err());
    }

    #[test]
    fn rejects_bad_netlists() {
        assert!(parse("R r1 a b 1k\nOUT b").is_err()); // no input
        assert!(parse("V v a 0 IN\nR r a b -1\nOUT b").is_err());
        assert!(parse("V v a 0 IN\nD d a 0 NOPE\nOUT a").is_err());
        assert!(parse("V v a 0 IN\nR r a b 1k").is_err()); // no OUT
    }
}

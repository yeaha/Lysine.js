import test from "ava";
import * as AnyORM from "../src/index";

test("normalize options", (t) => {
    const column: AnyORM.ColumnInterface = AnyORM.ColumnFactory("any");
    const options = column.getOptions();

    t.is(options.nullable, false);
    t.is(options.primary, false);
    t.is(options.default, null);
    t.is(options.protected, false);
    t.is(options.strict, false);
    t.is(options.refuseUpdate, false);
});

test("normalize primary options", (t) => {
    const column = AnyORM.ColumnFactory("any", { primary: true });
    const options = column.getOptions();

    t.is(options.primary, true);
    t.is(options.strict, true);
    t.is(options.refuseUpdate, true);
});

test("ColumnFactory", (t) => {
    const ColumnFactory = AnyORM.ColumnFactory;

    t.true(ColumnFactory("foobar") instanceof AnyORM.AnyColumn);
    t.true(ColumnFactory("numeric") instanceof AnyORM.NumericColumn);
    t.true(ColumnFactory("integer") instanceof AnyORM.IntegerColumn);
    t.true(ColumnFactory("text") instanceof AnyORM.TextColumn);
});

// Numeric type
(() => {
    const column = AnyORM.ColumnFactory("numeric");

    test("NumericColumn.normalize()", (t) => {
        t.is(column.normalize(1.23), 1.23);
        t.is(column.normalize("1.10"), 1.1);
    });

    test("NumericColumn.store()", (t) => {
        t.is(column.store(1), 1);
        t.is(column.store(null), null);
        t.is(column.store(""), null);
    });

    test("NumericColumn.retrieve()", (t) => {
        t.is(column.retrieve(1), 1);
        t.is(column.retrieve("0"), 0);
        t.is(column.retrieve(null), null);
        t.is(column.retrieve(""), null);
    });

    test("NumericColumn.normalize() unexpect value", (t) => {
        t.throws(() => {
            column.normalize(Infinity);
        }, AnyORM.UnexpectColumnValueError);

        t.throws(() => {
            column.normalize("a");
        }, AnyORM.UnexpectColumnValueError);
    });
})();

// UUID Type
(() => {
    test("UUID auto generator", (t) => {
        const column = AnyORM.ColumnFactory("uuid", { autoGenerate: true });

        t.regex(column.getDefaultValue(), /^[0-9a-f\-]{36}$/);
    });

    test("UUID upperCase option", (t) => {
        const column = AnyORM.ColumnFactory("uuid", { upperCase: true }) as AnyORM.UUIDColumn;

        t.regex(column.generate(), /^[0-9A-Z\-]{36}$/);
    });

    test("UUID as primary key", (t) => {
        const column = AnyORM.ColumnFactory("uuid", { primary: true });

        t.regex(column.getDefaultValue(), /^[0-9a-f\-]{36}$/);
    });
})();
